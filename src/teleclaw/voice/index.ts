import type {
  OnCallVoiceSynthesisErrorCode,
  OnCallVoiceSynthesisResult,
  OnCallVoiceTranscriptResult,
} from "../types.js";
import { transcribeWithMockProvider } from "./providers/mock.js";
import { transcribeWithWhisperCpp, type WhisperCppRunner } from "./providers/stt-whispercpp.js";
import { resolveOpenAiTtsConfig, synthesizeWithOpenAiTts } from "./providers/tts-openai.js";
import {
  resolvePiperTtsConfig,
  synthesizeWithPiper,
  type PiperRunner,
} from "./providers/tts-piper.js";

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
  sttLanguage?: string;
  sttMinConfidence?: number;
  sttProviderTimeoutMs?: number;
  sttWhisperCppBin?: string;
  sttWhisperCppModel?: string;
  sttWhisperCppLanguage?: string;
  sttWhisperCppThreads?: number;
  ttsProvider?: string;
  ttsApiKey?: string;
  ttsModel?: string;
  ttsVoice?: string;
  ttsFormat?: "mp3" | "wav" | "opus" | "aac" | "flac" | "pcm";
  ttsOutputDir?: string;
  ttsBaseUrl?: string;
  ttsProviderTimeoutMs?: number;
  ttsPiperBin?: string;
  ttsPiperModel?: string;
  ttsPiperVoice?: string;
  enableVoiceReplies?: boolean;
};

type ProviderDeps = {
  whisperCppRunner?: WhisperCppRunner;
  piperRunner?: PiperRunner;
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
    sttProvider: process.env.STT_PROVIDER ?? "whisper.cpp",
    sttApiKey: process.env.STT_API_KEY,
    sttModel: process.env.STT_MODEL,
    sttLanguage: process.env.STT_LANGUAGE,
    sttMinConfidence: parseFloatNumber(process.env.STT_MIN_CONFIDENCE, 0.35),
    sttProviderTimeoutMs: parseInteger(process.env.STT_PROVIDER_TIMEOUT_MS, 60000),
    sttWhisperCppBin: process.env.STT_WHISPERCPP_BIN ?? "whisper-cli",
    sttWhisperCppModel: process.env.STT_WHISPERCPP_MODEL ?? process.env.STT_MODEL,
    sttWhisperCppLanguage: process.env.STT_WHISPERCPP_LANGUAGE ?? process.env.STT_LANGUAGE,
    sttWhisperCppThreads: parseInteger(process.env.STT_WHISPERCPP_THREADS, 4),
    ttsProvider: process.env.TTS_PROVIDER ?? "piper",
    ttsApiKey: process.env.TTS_API_KEY,
    ttsModel: process.env.TTS_MODEL ?? "gpt-4o-mini-tts",
    ttsVoice: process.env.TTS_VOICE ?? "alloy",
    ttsFormat: (process.env.TTS_FORMAT as OnCallVoiceServiceConfig["ttsFormat"]) ?? "mp3",
    ttsOutputDir: process.env.TTS_OUTPUT_DIR,
    ttsBaseUrl: process.env.TTS_BASE_URL,
    ttsProviderTimeoutMs: parseInteger(process.env.TTS_PROVIDER_TIMEOUT_MS, 30000),
    ttsPiperBin: process.env.TTS_PIPER_BIN ?? "piper",
    ttsPiperModel: process.env.TTS_PIPER_MODEL,
    ttsPiperVoice: process.env.TTS_PIPER_VOICE,
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

      if (resolved.sttProvider === "whisper.cpp") {
        try {
          return await transcribeWithWhisperCpp(
            { audioUrl: input.audioUrl },
            {
              bin: resolved.sttWhisperCppBin ?? "whisper-cli",
              model: resolved.sttWhisperCppModel ?? resolved.sttModel ?? "",
              language: resolved.sttWhisperCppLanguage ?? resolved.sttLanguage,
              threads: resolved.sttWhisperCppThreads ?? 4,
              timeoutMs: resolved.sttProviderTimeoutMs ?? 60000,
              minConfidence: resolved.sttMinConfidence ?? 0.35,
            },
            deps.whisperCppRunner,
          );
        } catch (error) {
          return {
            text: "",
            provider: "whisper.cpp",
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

      const voiceSafeText = trimForVoice(text);
      if (!voiceSafeText) {
        throw new OnCallVoiceSynthesisProviderError({
          code: "tts_provider_not_configured",
          message: "No speakable content provided.",
          provider: resolved.ttsProvider,
        });
      }

      if (resolved.ttsProvider === "piper") {
        if (!resolved.ttsPiperModel?.trim()) {
          throw new OnCallVoiceSynthesisProviderError({
            code: "tts_provider_not_configured",
            message: "Piper TTS requires TTS_PIPER_MODEL to be set.",
            provider: "piper",
            voice: resolved.ttsPiperVoice,
          });
        }

        try {
          return await synthesizeWithPiper(
            voiceSafeText,
            resolvePiperTtsConfig({
              bin: resolved.ttsPiperBin,
              model: resolved.ttsPiperModel,
              voice: resolved.ttsPiperVoice,
              outputDir: resolved.ttsOutputDir,
              timeoutMs: resolved.ttsProviderTimeoutMs,
            }),
            deps.piperRunner,
          );
        } catch (error) {
          throw new OnCallVoiceSynthesisProviderError({
            code: "tts_provider_failed",
            message: "Piper synthesis failed.",
            provider: "piper",
            voice: resolved.ttsPiperVoice,
            cause: error,
          });
        }
      }

      if (resolved.ttsProvider === "openai") {
        if (!resolved.ttsApiKey) {
          throw new OnCallVoiceSynthesisProviderError({
            code: "tts_provider_not_configured",
            message: "OpenAI TTS provider is configured without API key.",
            provider: resolved.ttsProvider,
          });
        }

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
