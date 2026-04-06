import type { OnCallVoiceSynthesisResult, OnCallVoiceTranscriptResult } from "../types.js";

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
  ttsProvider?: string;
  ttsApiKey?: string;
};

function defaultConfig(): OnCallVoiceServiceConfig {
  return {
    sttProvider: process.env.STT_PROVIDER,
    sttApiKey: process.env.STT_API_KEY,
    ttsProvider: process.env.TTS_PROVIDER,
    ttsApiKey: process.env.TTS_API_KEY,
  };
}

export function createOnCallVoiceService(
  config: Partial<OnCallVoiceServiceConfig> = {},
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

      if (!resolved.sttProvider || !resolved.sttApiKey) {
        return {
          text: "",
          provider: resolved.sttProvider ?? "mock-stt",
          metadata: {
            configuredProvider: resolved.sttProvider ?? null,
            hasApiKey: Boolean(resolved.sttApiKey),
            quality: "missing",
            reason: "stt_unavailable",
          },
        };
      }

      // TODO(teleclaw): Add production STT provider integration (for example Whisper or provider plugin) once deployment secrets are available.
      return {
        text: "",
        provider: resolved.sttProvider,
        metadata: {
          configuredProvider: resolved.sttProvider,
          hasApiKey: Boolean(resolved.sttApiKey),
          quality: "missing",
          reason: "provider_not_implemented",
        },
      };
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
