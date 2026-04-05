import { describe, expect, it, vi } from "vitest";
import { createOpenHandsAdapter } from "./adapter.js";

describe("createOpenHandsAdapter", () => {
  it("sends project-aware context payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok", text: "done" }),
    });
    const adapter = createOpenHandsAdapter({
      baseUrl: "http://localhost:3100",
      model: "gpt-5.4",
      llmBaseUrl: "http://llm.local",
      llmApiKey: "secret",
      fetchImpl: fetchImpl as never,
    });

    await adapter.runTask("billing", "fix tests", {
      sessionId: "session:chat-1",
      workerSessionId: "worker-1",
      workspacePath: "/workspace/billing",
      containerId: "ctr-billing",
      containerName: "teleclaw-billing",
      runtimeFamily: "node",
      summary: "Tests failing",
      structuredState: { branch: "feat/billing" },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const request = fetchImpl.mock.calls[0]?.[1] as { body: string };
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({
      action: "task",
      projectId: "billing",
      instruction: "fix tests",
      sessionId: "session:chat-1",
      workerSessionId: "worker-1",
      workspacePath: "/workspace/billing",
      containerId: "ctr-billing",
      containerName: "teleclaw-billing",
      runtimeFamily: "node",
      llmBaseUrl: "http://llm.local",
      llmApiKey: "secret",
      model: "gpt-5.4",
    });
  });

  it("forwards worker progress events to callback seam", async () => {
    const onProgress = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "ok",
        text: "done",
        progressEvents: [
          {
            atMs: Date.now(),
            kind: "testing_started",
            message: "running tests",
          },
        ],
      }),
    });
    const adapter = createOpenHandsAdapter({
      baseUrl: "http://localhost:3100",
      fetchImpl: fetchImpl as never,
    });

    await adapter.runTask("billing", "run tests", { onProgress });

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "testing_started",
      }),
    );
  });
});
