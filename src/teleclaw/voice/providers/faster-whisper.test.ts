import { describe, expect, it, vi } from "vitest";
import { transcribeWithFasterWhisper } from "./faster-whisper.js";

describe("faster-whisper provider", () => {
  it("returns structured transcript payload", async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        text: "continue billing",
        language: "en",
        duration: 2.4,
        duration_after_vad: 2.1,
        avg_logprob: -0.2,
        no_speech_prob: 0.01,
        segment_count: 2,
      }),
      stderr: "",
    });

    const result = await transcribeWithFasterWhisper(
      { audioUrl: "https://voice.test/1.ogg" },
      {
        pythonBin: "python3",
        model: "small",
        device: "cpu",
        computeType: "int8",
        language: "en",
        beamSize: 5,
        vadFilter: true,
        timeoutMs: 60000,
        minConfidence: 0.35,
      },
      runner,
    );

    expect(result).toMatchObject({
      text: "continue billing",
      provider: "faster-whisper",
      metadata: {
        language: "en",
        durationSeconds: 2.4,
        durationAfterVadSeconds: 2.1,
        segmentCount: 2,
        quality: "high",
      },
    });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("throws when provider reports an error payload", async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ error: "failed to decode audio" }),
      stderr: "",
    });

    await expect(
      transcribeWithFasterWhisper(
        { audioUrl: "https://voice.test/bad.ogg" },
        {
          pythonBin: "python3",
          model: "small",
          device: "cpu",
          computeType: "int8",
          beamSize: 5,
          vadFilter: true,
          timeoutMs: 1000,
          minConfidence: 0.2,
        },
        runner,
      ),
    ).rejects.toThrow("failed to decode audio");
  });
});
