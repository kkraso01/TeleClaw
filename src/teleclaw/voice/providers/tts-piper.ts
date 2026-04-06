import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OnCallVoiceSynthesisResult } from "../../types.js";

export type PiperTtsConfig = {
  bin: string;
  model: string;
  voice?: string;
  outputDir: string;
  timeoutMs: number;
};

export type PiperRunner = (input: {
  command: string;
  args: string[];
  timeoutMs: number;
  stdinText: string;
}) => Promise<{ stdout: string; stderr: string }>;

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
    timeoutMs:
      input.timeoutMs ??
      Number.parseInt(process.env.TTS_PROVIDER_TIMEOUT_MS ?? "30000", 10) ??
      30000,
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
      retention: "artifacts are retained until manually cleaned up from TTS_OUTPUT_DIR",
    },
  };
}
