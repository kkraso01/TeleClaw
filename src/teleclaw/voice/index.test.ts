import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
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

  it("returns disabled error when voice replies are not enabled", async () => {
    const voice = createOnCallVoiceService({
      enableVoiceReplies: false,
      ttsProvider: "openai",
      ttsApiKey: "sk-test",
    });
    await expect(voice.synthesizeSpeech("hello")).rejects.toMatchObject({
      code: "tts_disabled",
    });
  });

  it("uses openai provider when configured and writes an audio artifact", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-tts-"));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("voice-bytes").buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    const voice = createOnCallVoiceService({
      enableVoiceReplies: true,
      ttsProvider: "openai",
      ttsApiKey: "sk-test",
      ttsModel: "gpt-4o-mini-tts",
      ttsVoice: "alloy",
      ttsFormat: "mp3",
      ttsOutputDir: tmpDir,
      ttsBaseUrl: "https://api.openai.com/v1",
      ttsProviderTimeoutMs: 1000,
    });

    const result = await voice.synthesizeSpeech("status update: tests are green");

    expect(result.provider).toBe("openai");
    expect(result.voice).toBe("alloy");
    expect(result.format).toBe("mp3");
    expect(result.mediaUrl).toContain(tmpDir);
    expect(fetchMock).toHaveBeenCalled();
    const stored = await readFile(result.mediaUrl, "utf8");
    expect(stored).toBe("voice-bytes");
    vi.unstubAllGlobals();
  });

  it("returns unsupported error for unknown TTS providers", async () => {
    const voice = createOnCallVoiceService({
      enableVoiceReplies: true,
      ttsProvider: "unknown-tts",
      ttsApiKey: "k",
    });
    await expect(voice.synthesizeSpeech("hello")).rejects.toMatchObject({
      code: "tts_provider_not_supported",
    });
  });
});
