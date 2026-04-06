import { mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePiperTtsConfig, synthesizeWithPiper } from "./tts-piper.js";

describe("piper TTS provider", () => {
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  });

  afterEach(() => {
    nowSpy.mockRestore();
    vi.unstubAllEnvs();
  });

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
        outputTtlSeconds: 3600,
        outputMaxFiles: 10,
      },
      runner,
    );

    expect(result).toMatchObject({
      provider: "piper",
      voice: "0",
      format: "wav",
      metadata: {
        retention: "ttl=3600s,maxFiles=10",
        cleanupRemovedFiles: 0,
      },
    });
    const stored = await readFile(result.mediaUrl, "utf8");
    expect(stored).toBe("voice-bytes");
  });

  it("removes expired artifacts before synthesis", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-piper-cleanup-"));
    const oldFile = path.join(outputDir, "old.wav");
    const freshFile = path.join(outputDir, "fresh.wav");

    await writeFile(oldFile, "old");
    await writeFile(freshFile, "fresh");

    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const freshTime = new Date(Date.now() - 30 * 1000);
    await utimes(oldFile, oldTime, oldTime);
    await utimes(freshFile, freshTime, freshTime);

    const result = await synthesizeWithPiper(
      "cleanup check",
      {
        bin: "piper",
        model: "./models/en_US-lessac-medium.onnx",
        outputDir,
        timeoutMs: 2000,
        outputTtlSeconds: 60,
        outputMaxFiles: 50,
      },
      async ({ args }) => {
        const outputPath = args[args.indexOf("--output_file") + 1];
        await writeFile(outputPath, "voice");
        return { stdout: "", stderr: "" };
      },
    );

    await expect(readFile(oldFile, "utf8")).rejects.toThrow();
    await expect(readFile(freshFile, "utf8")).resolves.toBe("fresh");
    await expect(readFile(result.artifactPath ?? result.mediaUrl, "utf8")).resolves.toBe("voice");
    expect(result.metadata?.cleanupRemovedFiles).toBe(1);
  });

  it("enforces max file retention by pruning oldest files", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-piper-maxfiles-"));
    const oldest = path.join(outputDir, "oldest.wav");
    const middle = path.join(outputDir, "middle.wav");
    const newest = path.join(outputDir, "newest.wav");

    await writeFile(oldest, "oldest");
    await writeFile(middle, "middle");
    await writeFile(newest, "newest");

    await utimes(oldest, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    await utimes(middle, new Date(Date.now() - 30_000), new Date(Date.now() - 30_000));
    await utimes(newest, new Date(Date.now() - 10_000), new Date(Date.now() - 10_000));

    await synthesizeWithPiper(
      "max files check",
      {
        bin: "piper",
        model: "./models/en_US-lessac-medium.onnx",
        outputDir,
        timeoutMs: 2000,
        outputTtlSeconds: 24 * 60 * 60,
        outputMaxFiles: 2,
      },
      async ({ args }) => {
        const outputPath = args[args.indexOf("--output_file") + 1];
        await writeFile(outputPath, "voice");
        return { stdout: "", stderr: "" };
      },
    );

    await expect(readFile(oldest, "utf8")).rejects.toThrow();
    await expect(readFile(middle, "utf8")).resolves.toBe("middle");
    await expect(readFile(newest, "utf8")).resolves.toBe("newest");
  });

  it("resolves defaults from local env", () => {
    vi.stubEnv("TTS_PIPER_BIN", "custom-piper");
    vi.stubEnv("TTS_PIPER_MODEL", "./models/default.onnx");
    const config = resolvePiperTtsConfig({});
    expect(config.bin).toBe("custom-piper");
    expect(config.model).toBe("./models/default.onnx");
    expect(config.outputTtlSeconds).toBe(7 * 24 * 60 * 60);
    expect(config.outputMaxFiles).toBe(500);
  });
});
