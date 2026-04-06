import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OnCallVoiceTranscriptResult } from "../../types.js";

export type WhisperCppProviderConfig = {
  bin: string;
  model: string;
  language?: string;
  threads: number;
  timeoutMs: number;
  minConfidence: number;
};

type WhisperCppJsonSegment = {
  text?: string;
  t0?: number;
  t1?: number;
  no_speech_prob?: number;
  avg_logprob?: number;
  p?: number;
};

type WhisperCppJsonResult = {
  result?: {
    language?: string;
  };
  transcription?: Array<WhisperCppJsonSegment>;
  segments?: Array<WhisperCppJsonSegment>;
};

export type WhisperCppRunner = (input: {
  command: string;
  args: string[];
  timeoutMs: number;
}) => Promise<{ stdout: string; stderr: string }>;

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function confidenceFromSegment(segment: WhisperCppJsonSegment): number | null {
  const explicit = segment.p;
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return clampConfidence(explicit);
  }

  const logProb = segment.avg_logprob;
  const noSpeech = segment.no_speech_prob;
  if (typeof logProb !== "number" || !Number.isFinite(logProb)) {
    return null;
  }

  const logProbScore = clampConfidence((logProb + 1.6) / 1.6);
  const noSpeechPenalty =
    typeof noSpeech === "number" && Number.isFinite(noSpeech) ? clampConfidence(1 - noSpeech) : 1;
  return clampConfidence(logProbScore * noSpeechPenalty);
}

function averageConfidence(segments: WhisperCppJsonSegment[]): number | null {
  const scores = segments.map(confidenceFromSegment).filter((score) => typeof score === "number");
  if (!scores.length) {
    return null;
  }
  const total = scores.reduce((sum, score) => sum + (score ?? 0), 0);
  return clampConfidence(total / scores.length);
}

function durationSecondsFromSegments(segments: WhisperCppJsonSegment[]): number | null {
  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;
  for (const segment of segments) {
    if (typeof segment.t0 === "number" && Number.isFinite(segment.t0)) {
      minStart = Math.min(minStart, segment.t0);
    }
    if (typeof segment.t1 === "number" && Number.isFinite(segment.t1)) {
      maxEnd = Math.max(maxEnd, segment.t1);
    }
  }

  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd) || maxEnd <= minStart) {
    return null;
  }

  // whisper.cpp CLI JSON commonly reports centiseconds.
  return (maxEnd - minStart) / 100;
}

function defaultRunner(input: {
  command: string;
  args: string[];
  timeoutMs: number;
}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`stt_timeout_after_${input.timeoutMs}ms`));
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
      reject(new Error(stderr.trim() || `whisper.cpp exited with code ${code ?? "unknown"}`));
    });
  });
}

async function resolveAudioFilePath(audioUrl: string, tmpDir: string): Promise<string> {
  if (audioUrl.startsWith("file://")) {
    return audioUrl.slice("file://".length);
  }

  if (/^https?:\/\//.test(audioUrl)) {
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`stt_audio_download_failed_http_${response.status}`);
    }
    const extension = path.extname(new URL(audioUrl).pathname) || ".audio";
    const localPath = path.join(tmpDir, `voice-input-${randomUUID()}${extension}`);
    const audioBytes = Buffer.from(await response.arrayBuffer());
    await writeFile(localPath, audioBytes);
    return localPath;
  }

  return audioUrl;
}

export async function transcribeWithWhisperCpp(
  input: {
    audioUrl: string;
  },
  config: WhisperCppProviderConfig,
  runner: WhisperCppRunner = defaultRunner,
): Promise<OnCallVoiceTranscriptResult> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-whispercpp-"));
  const outputBase = path.join(tempDir, `whisper-output-${Date.now()}-${randomUUID()}`);

  try {
    const audioPath = await resolveAudioFilePath(input.audioUrl, tempDir);
    const args = [
      "-m",
      config.model,
      "-f",
      audioPath,
      "-otxt",
      "-oj",
      "-of",
      outputBase,
      "-t",
      String(config.threads),
      "-np",
    ];

    if (config.language?.trim()) {
      args.push("-l", config.language.trim());
    }

    await runner({
      command: config.bin,
      args,
      timeoutMs: config.timeoutMs,
    });

    const jsonPath = `${outputBase}.json`;
    const jsonRaw = await readFile(jsonPath, "utf8");
    const parsed = JSON.parse(jsonRaw) as WhisperCppJsonResult;
    const segments = parsed.transcription ?? parsed.segments ?? [];

    const text = segments
      .map((segment) => segment.text?.trim() ?? "")
      .filter(Boolean)
      .join(" ")
      .trim();
    const confidence = averageConfidence(segments);
    const weakByConfidence = typeof confidence === "number" && confidence < config.minConfidence;

    return {
      text,
      provider: "whisper.cpp",
      metadata: {
        language: parsed.result?.language ?? config.language ?? null,
        durationSeconds: durationSecondsFromSegments(segments),
        segmentCount: segments.length,
        confidence,
        quality: !text ? "missing" : weakByConfidence ? "low" : "high",
      },
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
