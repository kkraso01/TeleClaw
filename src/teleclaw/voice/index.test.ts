import { describe, expect, it } from "vitest";
import { createOnCallVoiceService } from "./index.js";

describe("createOnCallVoiceService", () => {
  it("uses transcript hints without calling external STT", async () => {
    const voice = createOnCallVoiceService();
    const transcript = await voice.transcribeAudio({
      audioUrl: "https://example.test/voice.ogg",
      transcriptHint: "hello from transcript",
    });

    expect(transcript.text).toBe("hello from transcript");
    expect(transcript.provider).toBe("telegram-transcript");
    expect(transcript.metadata).toMatchObject({ quality: "high", confidence: 1 });
  });

  it("uses faster-whisper by default when STT provider is not explicitly set", async () => {
    const voice = createOnCallVoiceService(
      {
        sttProvider: "faster-whisper",
        sttModel: "tiny",
        sttDevice: "cpu",
        sttComputeType: "int8",
        sttLanguage: "en",
        sttBeamSize: 3,
        sttVadFilter: true,
        sttProviderTimeoutMs: 5000,
      },
      {
        fasterWhisperRunner: async () => ({
          stdout: JSON.stringify({
            text: "status billing",
            language: "en",
            duration: 1.1,
            avg_logprob: -0.2,
            no_speech_prob: 0.05,
            segment_count: 1,
          }),
          stderr: "",
        }),
      },
    );

    const transcript = await voice.transcribeAudio({
      audioUrl: "https://example.test/voice.ogg",
    });

    expect(transcript.text).toBe("status billing");
    expect(transcript.provider).toBe("faster-whisper");
    expect(transcript.metadata).toMatchObject({
      language: "en",
      quality: "high",
    });
  });

  it("marks low-confidence faster-whisper transcripts as low quality", async () => {
    const voice = createOnCallVoiceService(
      {
        sttProvider: "faster-whisper",
        sttMinConfidence: 0.6,
      },
      {
        fasterWhisperRunner: async () => ({
          stdout: JSON.stringify({
            text: "maybe",
            language: "en",
            duration: 1.0,
            avg_logprob: -1.3,
            no_speech_prob: 0.7,
            segment_count: 1,
          }),
          stderr: "",
        }),
      },
    );

    const transcript = await voice.transcribeAudio({ audioUrl: "https://example.test/weak.ogg" });
    expect(transcript.metadata).toMatchObject({ quality: "low" });
  });

  it("returns a missing transcript when STT provider is disabled", async () => {
    const voice = createOnCallVoiceService({ sttProvider: "none" });
    const transcript = await voice.transcribeAudio({
      audioUrl: "https://example.test/voice.ogg",
    });

    expect(transcript.text).toBe("");
    expect(transcript.metadata).toMatchObject({
      quality: "missing",
      reason: "stt_unavailable",
    });
  });

  it("returns a clean provider failure payload when faster-whisper errors", async () => {
    const voice = createOnCallVoiceService(
      {
        sttProvider: "faster-whisper",
      },
      {
        fasterWhisperRunner: async () => {
          throw new Error("python missing faster_whisper");
        },
      },
    );

    const transcript = await voice.transcribeAudio({ audioUrl: "https://example.test/voice.ogg" });

    expect(transcript.text).toBe("");
    expect(transcript.provider).toBe("faster-whisper");
    expect(transcript.metadata).toMatchObject({
      quality: "missing",
      reason: "stt_provider_failure",
    });
  });

  it("returns unsupported provider response for unknown STT provider ids", async () => {
    const voice = createOnCallVoiceService({ sttProvider: "totally-unknown" });
    const transcript = await voice.transcribeAudio({ audioUrl: "https://example.test/voice.ogg" });

    expect(transcript.metadata).toMatchObject({ reason: "stt_provider_not_supported" });
  });

  it("throws when tts provider is not configured", async () => {
    const voice = createOnCallVoiceService({ ttsProvider: undefined, ttsApiKey: undefined });
    await expect(voice.synthesizeSpeech("hello")).rejects.toThrow("tts not configured");
  });
});
