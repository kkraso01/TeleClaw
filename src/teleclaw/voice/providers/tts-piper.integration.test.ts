import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePiperTtsConfig, synthesizeWithPiper } from "./tts-piper.js";

describe("piper real-binary integration", () => {
  it("runs local piper synthesis when explicitly enabled", async (context) => {
    if (process.env.TELECLAW_RUN_REAL_TTS_TESTS !== "1") {
      context.skip("Set TELECLAW_RUN_REAL_TTS_TESTS=1 to run real Piper integration checks.");
      return;
    }

    const config = resolvePiperTtsConfig({});
    if (!config.model?.trim()) {
      context.skip("TTS_PIPER_MODEL is required for the real Piper integration test.");
      return;
    }

    const hasBin =
      spawnSync("bash", ["-lc", `command -v ${config.bin}`], { stdio: "ignore" }).status === 0;
    if (!hasBin) {
      context.skip(`Piper binary not found on PATH: ${config.bin}`);
      return;
    }

    try {
      await access(config.model);
    } catch {
      context.skip(`Configured Piper model is not accessible: ${config.model}`);
      return;
    }

    const outputDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-piper-integration-"));
    try {
      const result = await synthesizeWithPiper("teleclaw integration check", {
        ...config,
        outputDir,
        outputTtlSeconds: 24 * 60 * 60,
        outputMaxFiles: 20,
        timeoutMs: 30_000,
      });

      expect(result.provider).toBe("piper");
      const audioBytes = await readFile(result.artifactPath ?? result.mediaUrl);
      expect(audioBytes.byteLength).toBeGreaterThan(44);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
