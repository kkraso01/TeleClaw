import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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

  it("defaults STT provider to whisper.cpp", async () => {
    const voice = createOnCallVoiceService({
      sttWhisperCppModel: "./models/ggml-base.en.bin",
    });

    const transcript = await voice.transcribeAudio({ audioUrl: "/tmp/missing-audio.ogg" });
    expect(transcript.provider).toBe("whisper.cpp");
    expect(transcript.metadata).toMatchObject({ reason: "stt_provider_failure" });
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

  it("returns a clean provider failure payload when whisper.cpp errors", async () => {
    const voice = createOnCallVoiceService(
      {
        sttProvider: "whisper.cpp",
        sttWhisperCppModel: "./models/base.bin",
      },
      {
        whisperCppRunner: async () => {
          throw new Error("whisper binary missing");
        },
      },
    );

    const transcript = await voice.transcribeAudio({ audioUrl: "https://example.test/voice.ogg" });

    expect(transcript.text).toBe("");
    expect(transcript.provider).toBe("whisper.cpp");
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
      ttsProvider: "piper",
      ttsPiperModel: "./models/piper.onnx",
    });
    await expect(voice.synthesizeSpeech("hello")).rejects.toMatchObject({
      code: "tts_disabled",
    });
  });

  it("defaults TTS provider to piper", async () => {
    const voice = createOnCallVoiceService({ enableVoiceReplies: true });
    await expect(voice.synthesizeSpeech("hello")).rejects.toMatchObject({
      code: "tts_provider_not_configured",
      provider: "piper",
    });
  });

  it("uses piper provider when configured and writes an audio artifact", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-piper-"));

    const voice = createOnCallVoiceService(
      {
        enableVoiceReplies: true,
        ttsProvider: "piper",
        ttsPiperBin: "piper",
        ttsPiperModel: "./models/piper.onnx",
        ttsPiperVoice: "en_US",
        ttsOutputDir: tmpDir,
        ttsProviderTimeoutMs: 1000,
      },
      {
        piperRunner: async ({ args }) => {
          const outputIndex = args.indexOf("--output_file");
          const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : "";
          await writeFile(outputPath, "voice-bytes");
          return { stdout: "", stderr: "" };
        },
      },
    );

    const result = await voice.synthesizeSpeech("status update: tests are green");

    expect(result.provider).toBe("piper");
    expect(result.voice).toBe("en_US");
    expect(result.format).toBe("wav");
    expect(result.mediaUrl).toContain(tmpDir);
    const stored = await readFile(result.mediaUrl, "utf8");
    expect(stored).toBe("voice-bytes");
  });

  it("returns unsupported error for unknown TTS providers", async () => {
    const voice = createOnCallVoiceService({
      enableVoiceReplies: true,
      ttsProvider: "unknown-tts",
    });
    await expect(voice.synthesizeSpeech("hello")).rejects.toMatchObject({
      code: "tts_provider_not_supported",
    });
  });

  it("keeps openai as optional non-default provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("voice-bytes").buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-openai-"));
    const voice = createOnCallVoiceService({
      enableVoiceReplies: true,
      ttsProvider: "openai",
      ttsApiKey: "sk-test",
      ttsOutputDir: tmpDir,
    });

    const result = await voice.synthesizeSpeech("hello");
    expect(result.provider).toBe("openai");
    vi.unstubAllGlobals();
  });
});
