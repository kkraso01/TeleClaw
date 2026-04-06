import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { transcribeWithWhisperCpp } from "./stt-whispercpp.js";

describe("whisper.cpp provider", () => {
  it("returns structured transcript payload", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-whispercpp-test-"));
    const audioPath = path.join(tempDir, "sample.wav");
    await writeFile(audioPath, "audio");

    const runner = vi.fn().mockImplementation(async ({ args }) => {
      const outputIndex = args.indexOf("-of");
      const outputBase = outputIndex >= 0 ? args[outputIndex + 1] : "";
      await writeFile(
        `${outputBase}.json`,
        JSON.stringify({
          result: { language: "en" },
          transcription: [
            { text: "continue", t0: 0, t1: 90, avg_logprob: -0.2, no_speech_prob: 0.01 },
            { text: "billing", t0: 90, t1: 210, avg_logprob: -0.3, no_speech_prob: 0.02 },
          ],
        }),
      );
      return { stdout: "ok", stderr: "" };
    });

    const result = await transcribeWithWhisperCpp(
      { audioUrl: audioPath },
      {
        bin: "whisper-cli",
        model: "./models/ggml-base.en.bin",
        language: "en",
        threads: 2,
        timeoutMs: 60000,
        minConfidence: 0.35,
      },
      runner,
    );

    expect(result).toMatchObject({
      text: "continue billing",
      provider: "whisper.cpp",
      metadata: {
        language: "en",
        segmentCount: 2,
        quality: "high",
      },
    });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("supports file:// audio input", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-whispercpp-file-"));
    const audioPath = path.join(tempDir, "sample.wav");
    await writeFile(audioPath, "audio");

    const runner = vi.fn().mockImplementation(async ({ args }) => {
      const outputBase = args[args.indexOf("-of") + 1];
      await writeFile(
        `${outputBase}.json`,
        JSON.stringify({ transcription: [{ text: "status" }] }),
      );
      return { stdout: "", stderr: "" };
    });

    const result = await transcribeWithWhisperCpp(
      { audioUrl: `file://${audioPath}` },
      {
        bin: "whisper-cli",
        model: "./models/ggml-base.en.bin",
        threads: 1,
        timeoutMs: 1000,
        minConfidence: 0.2,
      },
      runner,
    );

    expect(result.text).toBe("status");
  });
});
