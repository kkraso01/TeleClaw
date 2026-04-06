import type {
  OnCallVoiceSynthesisErrorCode,
  OnCallVoiceSynthesisResult,
  OnCallVoiceTranscriptResult,
} from "../types.js";
import {
  transcribeWithFasterWhisper,
  type FasterWhisperRunner,
} from "./providers/faster-whisper.js";
import { transcribeWithMockProvider } from "./providers/mock.js";
import { resolveOpenAiTtsConfig, synthesizeWithOpenAiTts } from "./providers/tts-openai.js";

export type OnCallVoiceService = {
  transcribeAudio: (input: {
    audioUrl: string;
    transcriptHint?: string;
  }) => Promise<OnCallVoiceTranscriptResult>;
  synthesizeSpeech: (
    text: string,
    options?: { sessionId?: string; projectId?: string },
  ) => Promise<OnCallVoiceSynthesisResult>;
};

export type OnCallVoiceServiceConfig = {
  sttProvider?: string;
  sttApiKey?: string;
  sttModel?: string;
  sttDevice?: string;
  sttComputeType?: string;
  sttLanguage?: string;
  sttBeamSize?: number;
  sttVadFilter?: boolean;
  sttMinConfidence?: number;
  sttProviderTimeoutMs?: number;
  sttPythonBin?: string;
  ttsProvider?: string;
  ttsApiKey?: string;
  ttsModel?: string;
  ttsVoice?: string;
  ttsFormat?: "mp3" | "wav" | "opus" | "aac" | "flac" | "pcm";
  ttsOutputDir?: string;
  ttsBaseUrl?: string;
  ttsProviderTimeoutMs?: number;
  enableVoiceReplies?: boolean;
};

type ProviderDeps = {
  fasterWhisperRunner?: FasterWhisperRunner;
};

export class OnCallVoiceSynthesisProviderError extends Error {
  readonly code: OnCallVoiceSynthesisErrorCode;
  readonly provider?: string;
  readonly voice?: string;
  readonly causeMessage?: string;

  constructor(params: {
    code: OnCallVoiceSynthesisErrorCode;
    message: string;
    provider?: string;
    voice?: string;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = "OnCallVoiceSynthesisProviderError";
    this.code = params.code;
    this.provider = params.provider;
    this.voice = params.voice;
    this.causeMessage =
      params.cause instanceof Error
        ? params.cause.message
        : typeof params.cause === "string"
          ? params.cause
          : typeof params.cause === "number" || typeof params.cause === "boolean"
            ? `${params.cause}`
            : params.cause &&
                typeof params.cause === "object" &&
                "message" in params.cause &&
                typeof (params.cause as { message?: unknown }).message === "string"
              ? (params.cause as { message: string }).message
              : undefined;
  }
}

function parseInteger(input: string | undefined, fallback: number): number {
  if (!input) {
    return fallback;
  }
  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatNumber(input: string | undefined, fallback: number): number {
  if (!input) {
    return fallback;
  }
  const parsed = Number.parseFloat(input);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(input: string | undefined, fallback: boolean): boolean {
  if (!input) {
    return fallback;
  }
  return input === "1" || input.toLowerCase() === "true";
}

function defaultConfig(): OnCallVoiceServiceConfig {
  return {
    sttProvider: process.env.STT_PROVIDER ?? "faster-whisper",
    sttApiKey: process.env.STT_API_KEY,
    sttModel: process.env.STT_MODEL ?? "base",
    sttDevice: process.env.STT_DEVICE ?? "cpu",
    sttComputeType: process.env.STT_COMPUTE_TYPE ?? "int8",
    sttLanguage: process.env.STT_LANGUAGE,
    sttBeamSize: parseInteger(process.env.STT_BEAM_SIZE, 5),
    sttVadFilter: parseBoolean(process.env.STT_VAD_FILTER, true),
    sttMinConfidence: parseFloatNumber(process.env.STT_MIN_CONFIDENCE, 0.35),
    sttProviderTimeoutMs: parseInteger(process.env.STT_PROVIDER_TIMEOUT_MS, 60000),
    sttPythonBin: process.env.STT_PYTHON_BIN ?? "python3",
    ttsProvider: process.env.TTS_PROVIDER,
    ttsApiKey: process.env.TTS_API_KEY,
    ttsModel: process.env.TTS_MODEL ?? "gpt-4o-mini-tts",
    ttsVoice: process.env.TTS_VOICE ?? "alloy",
    ttsFormat: (process.env.TTS_FORMAT as OnCallVoiceServiceConfig["ttsFormat"]) ?? "mp3",
    ttsOutputDir: process.env.TTS_OUTPUT_DIR,
    ttsBaseUrl: process.env.TTS_BASE_URL,
    ttsProviderTimeoutMs: parseInteger(process.env.TTS_PROVIDER_TIMEOUT_MS, 30000),
    enableVoiceReplies: parseBoolean(process.env.ENABLE_VOICE_REPLIES, false),
  };
}

function trimForVoice(input: string): string {
  return input
    .replace(/\s+/g, " ")
    .replace(/```[\s\S]*?```/g, "I made code changes.")
    .slice(0, 480)
    .trim();
}

export function createOnCallVoiceService(
  config: Partial<OnCallVoiceServiceConfig> = {},
  deps: ProviderDeps = {},
): OnCallVoiceService {
  const resolved = {
    ...defaultConfig(),
    ...config,
  };

  return {
    async transcribeAudio(input) {
      if (input.transcriptHint?.trim()) {
        return {
          text: input.transcriptHint.trim(),
          provider: "telegram-transcript",
          metadata: { source: "hint", quality: "high", confidence: 1 },
        };
      }

      if (!resolved.sttProvider || resolved.sttProvider === "none") {
        return await transcribeWithMockProvider({
          providerName: "mock-stt",
          configuredProvider: resolved.sttProvider,
          hasApiKey: Boolean(resolved.sttApiKey),
          reason: "stt_unavailable",
        });
      }

      if (resolved.sttProvider === "faster-whisper") {
        try {
          return await transcribeWithFasterWhisper(
            { audioUrl: input.audioUrl },
            {
              pythonBin: resolved.sttPythonBin ?? "python3",
              model: resolved.sttModel ?? "base",
              device: resolved.sttDevice ?? "cpu",
              computeType: resolved.sttComputeType ?? "int8",
              language: resolved.sttLanguage,
              beamSize: resolved.sttBeamSize ?? 5,
              vadFilter: resolved.sttVadFilter ?? true,
              timeoutMs: resolved.sttProviderTimeoutMs ?? 60000,
              minConfidence: resolved.sttMinConfidence ?? 0.35,
            },
            deps.fasterWhisperRunner,
          );
        } catch (error) {
          return {
            text: "",
            provider: "faster-whisper",
            metadata: {
              quality: "missing",
              reason: "stt_provider_failure",
              error: error instanceof Error ? error.message : String(error),
            },
          };
        }
      }

      return await transcribeWithMockProvider({
        providerName: resolved.sttProvider,
        configuredProvider: resolved.sttProvider,
        hasApiKey: Boolean(resolved.sttApiKey),
        reason: "stt_provider_not_supported",
      });
    },

    async synthesizeSpeech(text) {
      if (!resolved.enableVoiceReplies) {
        throw new OnCallVoiceSynthesisProviderError({
          code: "tts_disabled",
          message: "Voice replies are disabled by configuration.",
          provider: resolved.ttsProvider,
        });
      }
      if (!resolved.ttsProvider || resolved.ttsProvider === "none") {
        throw new OnCallVoiceSynthesisProviderError({
          code: "tts_provider_missing",
          message: "No TTS provider configured.",
        });
      }
      if (!resolved.ttsApiKey) {
        throw new OnCallVoiceSynthesisProviderError({
          code: "tts_provider_not_configured",
          message: "TTS provider is configured without API key.",
          provider: resolved.ttsProvider,
        });
      }

      const voiceSafeText = trimForVoice(text);
      if (!voiceSafeText) {
        throw new OnCallVoiceSynthesisProviderError({
          code: "tts_provider_not_configured",
          message: "No speakable content provided.",
          provider: resolved.ttsProvider,
        });
      }

      if (resolved.ttsProvider === "openai") {
        try {
          return await synthesizeWithOpenAiTts(
            voiceSafeText,
            resolveOpenAiTtsConfig({
              apiKey: resolved.ttsApiKey,
              model: resolved.ttsModel,
              voice: resolved.ttsVoice,
              format: resolved.ttsFormat,
              outputDir: resolved.ttsOutputDir,
              baseUrl: resolved.ttsBaseUrl,
              timeoutMs: resolved.ttsProviderTimeoutMs,
            }),
          );
        } catch (error) {
          throw new OnCallVoiceSynthesisProviderError({
            code: "tts_provider_failed",
            message: "OpenAI TTS synthesis failed.",
            provider: "openai",
            voice: resolved.ttsVoice,
            cause: error,
          });
        }
      }

      throw new OnCallVoiceSynthesisProviderError({
        code: "tts_provider_not_supported",
        message: `Unsupported TTS provider: ${resolved.ttsProvider}`,
        provider: resolved.ttsProvider,
      });
    },
  };
}
