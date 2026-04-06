import type { OnCallVoiceSynthesisResult, OnCallVoiceTranscriptResult } from "../types.js";
import {
  transcribeWithFasterWhisper,
  type FasterWhisperRunner,
} from "./providers/faster-whisper.js";
import { transcribeWithMockProvider } from "./providers/mock.js";

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
};

type ProviderDeps = {
  fasterWhisperRunner?: FasterWhisperRunner;
};

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
  };
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
      if (!resolved.ttsProvider || !resolved.ttsApiKey) {
        throw new Error("tts not configured");
      }

      // TODO(teleclaw): Add production TTS provider implementation and persist generated media at TELECLAW_VOICE_STORE_PATH.
      return {
        mediaUrl: `teleclaw://voice/${Date.now()}`,
        provider: resolved.ttsProvider,
        metadata: {
          preview: text.slice(0, 120),
        },
      };
    },
  };
}
