import { spawnSync } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { transcribeWithWhisperCpp } from "./stt-whispercpp.js";

function buildSilenceWav(options: { sampleRate: number; durationMs: number }): Buffer {
  const sampleCount = Math.floor((options.sampleRate * options.durationMs) / 1000);
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const dataSize = sampleCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(options.sampleRate, 24);
  buffer.writeUInt32LE(options.sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

describe("whisper.cpp real-binary integration", () => {
  it("runs local whisper.cpp when explicitly enabled", async (context) => {
    if (process.env.TELECLAW_RUN_REAL_STT_TESTS !== "1") {
      context.skip("Set TELECLAW_RUN_REAL_STT_TESTS=1 to run real whisper.cpp integration checks.");
      return;
    }

    const bin = process.env.STT_WHISPERCPP_BIN ?? "whisper-cli";
    const model = process.env.STT_WHISPERCPP_MODEL;
    if (!model?.trim()) {
      context.skip("STT_WHISPERCPP_MODEL is required for the real whisper.cpp integration test.");
      return;
    }

    const hasBin =
      spawnSync("bash", ["-lc", `command -v ${bin}`], { stdio: "ignore" }).status === 0;
    if (!hasBin) {
      context.skip(`whisper.cpp binary not found on PATH: ${bin}`);
      return;
    }

    try {
      await access(model);
    } catch {
      context.skip(`Configured whisper.cpp model is not accessible: ${model}`);
      return;
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-whispercpp-integration-"));
    try {
      const audioPath = path.join(tempDir, "silence.wav");
      await writeFile(audioPath, buildSilenceWav({ sampleRate: 16_000, durationMs: 300 }));

      const transcript = await transcribeWithWhisperCpp(
        { audioUrl: audioPath },
        {
          bin,
          model,
          language: process.env.STT_WHISPERCPP_LANGUAGE,
          threads: 2,
          timeoutMs: 60_000,
          minConfidence: 0,
        },
      );

      expect(transcript.provider).toBe("whisper.cpp");
      expect(transcript.metadata).toBeTruthy();
      expect(typeof transcript.metadata?.segmentCount).toBe("number");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
