import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OnCallVoiceSynthesisResult } from "../../types.js";

export type OpenAiTtsConfig = {
  apiKey: string;
  model: string;
  voice: string;
  format: "mp3" | "wav" | "opus" | "aac" | "flac" | "pcm";
  outputDir: string;
  baseUrl: string;
  timeoutMs: number;
};

const EXTENSION_BY_FORMAT: Record<OpenAiTtsConfig["format"], string> = {
  mp3: "mp3",
  wav: "wav",
  opus: "opus",
  aac: "aac",
  flac: "flac",
  pcm: "pcm",
};

function resolveDefaultVoiceDir(): string {
  return (
    process.env.TELECLAW_VOICE_STORE_PATH ??
    path.join(os.homedir(), ".openclaw", "teleclaw", "voice")
  );
}

export function resolveOpenAiTtsConfig(input: Partial<OpenAiTtsConfig>): OpenAiTtsConfig {
  return {
    apiKey: input.apiKey ?? process.env.TTS_API_KEY ?? "",
    model: input.model ?? process.env.TTS_MODEL ?? "gpt-4o-mini-tts",
    voice: input.voice ?? process.env.TTS_VOICE ?? "alloy",
    format: (input.format ?? process.env.TTS_FORMAT ?? "mp3") as OpenAiTtsConfig["format"],
    outputDir: input.outputDir ?? process.env.TTS_OUTPUT_DIR ?? resolveDefaultVoiceDir(),
    baseUrl: input.baseUrl ?? process.env.TTS_BASE_URL ?? "https://api.openai.com/v1",
    timeoutMs:
      input.timeoutMs ??
      Number.parseInt(process.env.TTS_PROVIDER_TIMEOUT_MS ?? "30000", 10) ??
      30000,
  };
}

export async function synthesizeWithOpenAiTts(
  text: string,
  config: OpenAiTtsConfig,
): Promise<OnCallVoiceSynthesisResult> {
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/audio/speech`;
  const timeoutSignal = AbortSignal.timeout(config.timeoutMs);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      voice: config.voice,
      input: text,
      format: config.format,
    }),
    signal: timeoutSignal,
  });

  if (!response.ok) {
    const reason = await response.text();
    throw new Error(`openai_tts_http_${response.status}:${reason.slice(0, 200)}`);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  const extension = EXTENSION_BY_FORMAT[config.format] ?? "mp3";
  await mkdir(config.outputDir, { recursive: true });
  const artifactPath = path.join(config.outputDir, `${Date.now()}-${randomUUID()}.${extension}`);
  await writeFile(artifactPath, audio);

  return {
    mediaUrl: artifactPath,
    artifactPath,
    provider: "openai",
    voice: config.voice,
    format: config.format,
    metadata: {
      model: config.model,
      outputBytes: audio.byteLength,
    },
  };
}
