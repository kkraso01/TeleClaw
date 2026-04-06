import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolvePiperTtsConfig, synthesizeWithPiper } from "./tts-piper.js";

describe("piper TTS provider", () => {
  it("returns structured artifact metadata", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-piper-provider-"));
    const runner = vi.fn().mockImplementation(async ({ args, stdinText }) => {
      const outputPath = args[args.indexOf("--output_file") + 1];
      expect(stdinText).toContain("billing");
      await writeFile(outputPath, "voice-bytes");
      return { stdout: "", stderr: "" };
    });

    const result = await synthesizeWithPiper(
      "billing status is green",
      {
        bin: "piper",
        model: "./models/en_US-lessac-medium.onnx",
        voice: "0",
        outputDir,
        timeoutMs: 2000,
      },
      runner,
    );

    expect(result).toMatchObject({
      provider: "piper",
      voice: "0",
      format: "wav",
    });
    const stored = await readFile(result.mediaUrl, "utf8");
    expect(stored).toBe("voice-bytes");
  });

  it("resolves defaults from local env", () => {
    vi.stubEnv("TTS_PIPER_BIN", "custom-piper");
    vi.stubEnv("TTS_PIPER_MODEL", "./models/default.onnx");
    const config = resolvePiperTtsConfig({});
    expect(config.bin).toBe("custom-piper");
    expect(config.model).toBe("./models/default.onnx");
    vi.unstubAllEnvs();
  });
});
