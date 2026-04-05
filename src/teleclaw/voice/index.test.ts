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
  });

  it("throws when tts provider is not configured", async () => {
    const voice = createOnCallVoiceService({ ttsProvider: undefined, ttsApiKey: undefined });
    await expect(voice.synthesizeSpeech("hello")).rejects.toThrow("tts not configured");
  });
});
