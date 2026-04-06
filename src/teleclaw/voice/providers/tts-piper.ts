import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OnCallVoiceSynthesisResult } from "../../types.js";

export type PiperTtsConfig = {
  bin: string;
  model: string;
  voice?: string;
  outputDir: string;
  timeoutMs: number;
  outputTtlSeconds: number;
  outputMaxFiles: number;
};

export type PiperRunner = (input: {
  command: string;
  args: string[];
  timeoutMs: number;
  stdinText: string;
}) => Promise<{ stdout: string; stderr: string }>;

type TtsArtifactCleanupSummary = {
  removedFiles: string[];
  keptFiles: number;
};

function parsePositiveInteger(input: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(input ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function resolveDefaultVoiceDir(): string {
  return (
    process.env.TELECLAW_VOICE_STORE_PATH ??
    path.join(os.homedir(), ".openclaw", "teleclaw", "voice")
  );
}

export function resolvePiperTtsConfig(input: Partial<PiperTtsConfig>): PiperTtsConfig {
  return {
    bin: input.bin ?? process.env.TTS_PIPER_BIN ?? "piper",
    model: input.model ?? process.env.TTS_PIPER_MODEL ?? "",
    voice: input.voice ?? process.env.TTS_PIPER_VOICE,
    outputDir: input.outputDir ?? process.env.TTS_OUTPUT_DIR ?? resolveDefaultVoiceDir(),
    timeoutMs: input.timeoutMs ?? parsePositiveInteger(process.env.TTS_PROVIDER_TIMEOUT_MS, 30000),
    outputTtlSeconds:
      input.outputTtlSeconds ??
      parsePositiveInteger(process.env.TTS_OUTPUT_TTL_SECONDS, 7 * 24 * 60 * 60),
    outputMaxFiles:
      input.outputMaxFiles ?? parsePositiveInteger(process.env.TTS_OUTPUT_MAX_FILES, 500),
  };
}

async function cleanupOldTtsArtifacts(
  outputDir: string,
  options: { ttlSeconds: number; maxFiles: number },
): Promise<TtsArtifactCleanupSummary> {
  const nowMs = Date.now();
  const ttlCutoffMs = nowMs - options.ttlSeconds * 1000;
  const removedFiles: string[] = [];

  const names = await readdir(outputDir);
  const fileRecords: Array<{ name: string; fullPath: string; mtimeMs: number }> = [];

  for (const name of names) {
    const fullPath = path.join(outputDir, name);
    const info = await stat(fullPath);
    if (!info.isFile()) {
      continue;
    }
    fileRecords.push({ name, fullPath, mtimeMs: info.mtimeMs });
  }

  const recordsByNewest = [...fileRecords].toSorted((a, b) => b.mtimeMs - a.mtimeMs);
  const retained = new Set(recordsByNewest.map((record) => record.name));

  for (const record of recordsByNewest) {
    if (record.mtimeMs >= ttlCutoffMs) {
      continue;
    }
    await rm(record.fullPath, { force: true });
    retained.delete(record.name);
    removedFiles.push(record.name);
  }

  const postTtlRecords = recordsByNewest.filter((record) => retained.has(record.name));
  if (postTtlRecords.length > options.maxFiles) {
    const overflow = postTtlRecords.slice(options.maxFiles);
    for (const record of overflow) {
      await rm(record.fullPath, { force: true });
      retained.delete(record.name);
      removedFiles.push(record.name);
    }
  }

  if (removedFiles.length > 0) {
    console.info(
      `[teleclaw][voice][piper] cleanup removed ${removedFiles.length} artifact(s) from ${outputDir}: ${removedFiles.join(", ")}`,
    );
  }

  return {
    removedFiles,
    keptFiles: retained.size,
  };
}

function defaultRunner(input: {
  command: string;
  args: string[];
  timeoutMs: number;
  stdinText: string;
}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`tts_timeout_after_${input.timeoutMs}ms`));
    }, input.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || `piper exited with code ${code ?? "unknown"}`));
    });

    child.stdin.write(input.stdinText);
    child.stdin.end();
  });
}

export async function synthesizeWithPiper(
  text: string,
  config: PiperTtsConfig,
  runner: PiperRunner = defaultRunner,
): Promise<OnCallVoiceSynthesisResult> {
  await mkdir(config.outputDir, { recursive: true });
  const cleanupSummary = await cleanupOldTtsArtifacts(config.outputDir, {
    ttlSeconds: config.outputTtlSeconds,
    maxFiles: config.outputMaxFiles,
  });

  const outputPath = path.join(config.outputDir, `${Date.now()}-${randomUUID()}.wav`);

  const args = ["--model", config.model, "--output_file", outputPath];
  if (config.voice?.trim()) {
    args.push("--speaker", config.voice.trim());
  }

  await runner({
    command: config.bin,
    args,
    timeoutMs: config.timeoutMs,
    stdinText: text,
  });

  return {
    mediaUrl: outputPath,
    artifactPath: outputPath,
    provider: "piper",
    voice: config.voice,
    format: "wav",
    metadata: {
      model: config.model,
      retention: `ttl=${config.outputTtlSeconds}s,maxFiles=${config.outputMaxFiles}`,
      cleanupRemovedFiles: cleanupSummary.removedFiles.length,
      cleanupKeptFiles: cleanupSummary.keptFiles,
    },
  };
}
