import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.fn();

vi.mock("./openhands/config.js", () => ({
  resolveOpenHandsBridgeConfig: vi.fn(() => ({
    enabled: true,
    mode: "vendor_local",
    endpoint: "http://localhost:3001",
    vendorPath: "/tmp/vendor/openhands",
    pythonBin: "python3",
  })),
}));

vi.mock("./openhands/index.js", () => ({
  createOpenHandsBridge: vi.fn(() => ({ run })),
}));

import { createOpenHandsAdapter } from "./adapter.js";

describe("createOpenHandsAdapter", () => {
  beforeEach(() => {
    run.mockReset();
  });

  it("routes task requests to bridge with context", async () => {
    run.mockResolvedValue({ status: "ok", text: "done" });
    const adapter = createOpenHandsAdapter();

    await adapter.runTask("billing", "fix tests", {
      sessionId: "session:chat-1",
      workerSessionId: "worker-1",
      workspacePath: "/workspace/billing",
      containerId: "ctr-billing",
      containerName: "teleclaw-billing",
      runtimeFamily: "node",
      executionProfile: {
        installCommand: "npm install",
        testCommand: "npm test",
        lintCommand: "npm run lint",
        buildCommand: "npm run build",
        runCommand: "npm run dev",
        packageManager: "npm",
        preferredShell: "bash",
      },
      repoMetadata: {
        repoUrl: "https://github.com/acme/billing.git",
        repoStatus: "clean",
        branch: "main",
      },
      bootstrapState: {
        bootstrapStatus: "ready",
        bootstrapError: null,
      },
      summary: "Tests failing",
      structuredState: { branch: "feat/billing" },
    });

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "task",
        projectId: "billing",
        instruction: "fix tests",
        context: expect.objectContaining({
          workerSessionId: "worker-1",
          workspacePath: "/workspace/billing",
        }),
      }),
    );
  });

  it("forwards worker progress events to callback seam", async () => {
    const onProgress = vi.fn();
    run.mockResolvedValue({
      status: "ok",
      text: "done",
      progressEvents: [
        {
          atMs: Date.now(),
          kind: "testing_started",
          message: "running tests",
        },
      ],
    });

    const adapter = createOpenHandsAdapter();
    await adapter.runTask("billing", "run tests", { onProgress });

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "testing_started",
      }),
    );
  });
});
