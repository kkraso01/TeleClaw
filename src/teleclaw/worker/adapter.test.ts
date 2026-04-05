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
      llmBaseUrl: "http://llm.local",
      llmApiKey: "secret",
      model: "gpt-5.4",
    });
  });
});
