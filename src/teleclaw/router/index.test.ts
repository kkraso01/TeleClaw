import { describe, expect, it, vi } from "vitest";
import { createOnCallRouter } from "./index.js";

function buildSession(activeProjectId: string | null = null) {
  return {
    sessionId: "session:chat-1",
    chatId: "chat-1",
    userId: "u1",
    activeProjectId,
    workerBinding: { workerType: "openhands", workerSessionId: null, containerId: null },
    currentPhase: "idle",
    summary: "",
    durableFacts: [],
    structuredState: {},
    recentActions: [],
    artifactRefs: [],
    lastActiveAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function buildResolvedProject() {
  return {
    id: "billing",
    name: "Billing",
    aliases: ["billing"],
    language: "ts",
    workspacePath: `${process.cwd()}/workspace/billing`,
    containerId: "ctr-billing",
    runtimeFamily: "node",
    defaultReplyMode: "text",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("createOnCallRouter", () => {
  it("uses active project when no project is named", async () => {
    const projects = {
      resolveProject: vi.fn().mockResolvedValue({
        type: "resolved",
        via: "recent",
        project: buildResolvedProject(),
      }),
      rememberActiveProject: vi.fn().mockResolvedValue(undefined),
    };
    const sessions = {
      getOrCreateSession: vi.fn().mockResolvedValue(buildSession("billing")),
      bindProject: vi.fn().mockImplementation(async (_id, projectId) => buildSession(projectId)),
      bindWorker: vi.fn().mockResolvedValue(null),
      appendRecentAction: vi.fn().mockResolvedValue(null),
      setSummary: vi.fn().mockResolvedValue(null),
      setStructuredState: vi.fn().mockResolvedValue(null),
    };
    const memory = {
      appendEvent: vi.fn().mockResolvedValue(undefined),
      mergeDurableFacts: vi.fn().mockResolvedValue({}),
      getSummary: vi.fn().mockResolvedValue(""),
      getStructuredState: vi.fn().mockResolvedValue({}),
      setSummary: vi.fn().mockResolvedValue(undefined),
      compactSessionMemory: vi.fn().mockResolvedValue({ compactedEvents: 0 }),
    };
    const worker = {
      runTask: vi.fn().mockResolvedValue({ status: "ok", text: "done" }),
      resume: vi.fn().mockResolvedValue({ status: "ok", text: "resumed" }),
      getStatus: vi.fn().mockResolvedValue({ status: "ok", text: "healthy" }),
      summarize: vi.fn().mockResolvedValue({ status: "ok", text: "summary" }),
    };

    const router = createOnCallRouter({
      projects: projects as never,
      sessions: sessions as never,
      memory: memory as never,
      worker,
    });

    const response = await router.processInbound({
      channel: "telegram",
      userId: "user-1",
      chatId: "chat-1",
      body: "continue",
      timestampMs: Date.now(),
    });

    expect(response.outcome.type).toBe("success");
    expect(projects.resolveProject).toHaveBeenCalledWith({
      chatId: "chat-1",
      projectRef: "billing",
    });
  });

  it("answers status requests from stored memory without worker call", async () => {
    const worker = {
      runTask: vi.fn(),
      resume: vi.fn(),
      getStatus: vi.fn(),
      summarize: vi.fn(),
    };

    const router = createOnCallRouter({
      projects: {
        resolveProject: vi.fn().mockResolvedValue({
          type: "resolved",
          via: "id",
          project: buildResolvedProject(),
        }),
        rememberActiveProject: vi.fn().mockResolvedValue(undefined),
      } as never,
      sessions: {
        getOrCreateSession: vi.fn().mockResolvedValue(buildSession("billing")),
        bindProject: vi.fn().mockResolvedValue(buildSession("billing")),
        bindWorker: vi.fn().mockResolvedValue(null),
        appendRecentAction: vi.fn().mockResolvedValue(null),
        setSummary: vi.fn().mockResolvedValue(null),
        setStructuredState: vi.fn().mockResolvedValue(null),
      } as never,
      memory: {
        appendEvent: vi.fn().mockResolvedValue(undefined),
        mergeDurableFacts: vi.fn().mockResolvedValue({}),
        getSummary: vi.fn().mockResolvedValue("Implemented billing retries. Next: rerun tests."),
        getStructuredState: vi.fn().mockResolvedValue({}),
        setSummary: vi.fn().mockResolvedValue(undefined),
        compactSessionMemory: vi.fn().mockResolvedValue({ compactedEvents: 0 }),
      } as never,
      worker: worker as never,
    });

    const response = await router.processInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat-1",
      body: "status?",
      timestampMs: Date.now(),
    });

    expect(response.text).toContain("Status for Billing");
    expect(worker.getStatus).not.toHaveBeenCalled();
    if (response.outcome.type === "success") {
      expect(response.outcome.execution.source).toBe("memory");
    }
  });

  it("persists worker progress events", async () => {
    const appendEvent = vi.fn().mockResolvedValue(undefined);

    const router = createOnCallRouter({
      projects: {
        resolveProject: vi.fn().mockResolvedValue({
          type: "resolved",
          via: "id",
          project: buildResolvedProject(),
        }),
        rememberActiveProject: vi.fn().mockResolvedValue(undefined),
      } as never,
      sessions: {
        getOrCreateSession: vi.fn().mockResolvedValue(buildSession("billing")),
        bindProject: vi.fn().mockResolvedValue(buildSession("billing")),
        bindWorker: vi.fn().mockResolvedValue(null),
        appendRecentAction: vi.fn().mockResolvedValue(null),
        setSummary: vi.fn().mockResolvedValue(null),
        setStructuredState: vi.fn().mockResolvedValue(null),
      } as never,
      memory: {
        appendEvent,
        mergeDurableFacts: vi.fn().mockResolvedValue({}),
        getSummary: vi.fn().mockResolvedValue(""),
        getStructuredState: vi.fn().mockResolvedValue({}),
        setSummary: vi.fn().mockResolvedValue(undefined),
        compactSessionMemory: vi.fn().mockResolvedValue({ compactedEvents: 0 }),
      } as never,
      worker: {
        runTask: vi.fn().mockResolvedValue({
          status: "ok",
          text: "done",
          progressEvents: [
            {
              atMs: Date.now(),
              kind: "implementation_started",
              message: "editing billing endpoint",
              filesChanged: ["src/billing/endpoint.ts"],
            },
          ],
        }),
        resume: vi.fn().mockResolvedValue({ status: "ok", text: "resumed" }),
        getStatus: vi.fn().mockResolvedValue({ status: "ok", text: "status" }),
        summarize: vi.fn().mockResolvedValue({ status: "ok", text: "summary" }),
      },
    });

    await router.processInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat-1",
      body: "fix billing tests",
      timestampMs: Date.now(),
    });

    expect(
      appendEvent.mock.calls.some(
        (call) => call[0]?.type === "worker_status_progress" && call[0]?.projectId === "billing",
      ),
    ).toBe(true);
  });

  it("emits project_switch memory event when active project changes", async () => {
    const appendEvent = vi.fn().mockResolvedValue(undefined);
    const router = createOnCallRouter({
      projects: {
        resolveProject: vi.fn().mockResolvedValue({
          type: "resolved",
          via: "alias",
          project: buildResolvedProject(),
        }),
        rememberActiveProject: vi.fn().mockResolvedValue(undefined),
      } as never,
      sessions: {
        getOrCreateSession: vi.fn().mockResolvedValue(buildSession("frontend")),
        bindProject: vi.fn().mockResolvedValue(buildSession("billing")),
        bindWorker: vi.fn().mockResolvedValue(null),
        appendRecentAction: vi.fn().mockResolvedValue(null),
        setSummary: vi.fn().mockResolvedValue(null),
        setStructuredState: vi.fn().mockResolvedValue(null),
      } as never,
      memory: {
        appendEvent,
        mergeDurableFacts: vi.fn().mockResolvedValue({}),
        getSummary: vi.fn().mockResolvedValue(""),
        getStructuredState: vi.fn().mockResolvedValue({}),
        setSummary: vi.fn().mockResolvedValue(undefined),
        compactSessionMemory: vi.fn().mockResolvedValue({ compactedEvents: 0 }),
      } as never,
      worker: {
        runTask: vi.fn().mockResolvedValue({ status: "ok", text: "done" }),
        resume: vi.fn().mockResolvedValue({ status: "ok", text: "resumed" }),
        getStatus: vi.fn().mockResolvedValue({ status: "ok", text: "status" }),
        summarize: vi.fn().mockResolvedValue({ status: "ok", text: "summary" }),
      },
    });

    await router.processInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat-1",
      body: "switch to billing and continue",
      timestampMs: Date.now(),
    });

    expect(
      appendEvent.mock.calls.some(
        (call) => call[0]?.type === "project_switch" && call[0]?.fromProjectId === "frontend",
      ),
    ).toBe(true);
  });

  it("routes voice inbound through transcript and falls back to text reply when tts is unavailable", async () => {
    const router = createOnCallRouter({
      projects: {
        resolveProject: vi.fn().mockResolvedValue({
          type: "resolved",
          via: "id",
          project: buildResolvedProject(),
        }),
        rememberActiveProject: vi.fn().mockResolvedValue(undefined),
      } as never,
      sessions: {
        getOrCreateSession: vi.fn().mockResolvedValue(buildSession("billing")),
        bindProject: vi.fn().mockResolvedValue(buildSession("billing")),
        bindWorker: vi.fn().mockResolvedValue(null),
        appendRecentAction: vi.fn().mockResolvedValue(null),
        setSummary: vi.fn().mockResolvedValue(null),
        setStructuredState: vi.fn().mockResolvedValue(null),
      } as never,
      memory: {
        appendEvent: vi.fn().mockResolvedValue(undefined),
        mergeDurableFacts: vi.fn().mockResolvedValue({}),
        getSummary: vi.fn().mockResolvedValue(""),
        getStructuredState: vi.fn().mockResolvedValue({}),
        setSummary: vi.fn().mockResolvedValue(undefined),
        compactSessionMemory: vi.fn().mockResolvedValue({ compactedEvents: 0 }),
      } as never,
      worker: {
        runTask: vi.fn().mockResolvedValue({ status: "ok", text: "done" }),
        resume: vi.fn().mockResolvedValue({ status: "ok", text: "resumed" }),
        getStatus: vi.fn().mockResolvedValue({ status: "ok", text: "status" }),
        summarize: vi.fn().mockResolvedValue({ status: "ok", text: "summary" }),
      },
      voice: {
        transcribeAudio: vi
          .fn()
          .mockResolvedValue({ text: "resume and reply with voice", provider: "mock" }),
        synthesizeSpeech: vi.fn().mockRejectedValue(new Error("tts not configured")),
      },
    });

    const response = await router.processVoiceInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat-1",
      audioUrl: "https://example.test/voice.ogg",
      timestampMs: Date.now(),
    });

    expect(response.replyMode).toBe("voice");
    expect(response.voiceReply).toBeUndefined();
    expect(response.text).toBe("resumed");
  });

  it("returns clarification for ambiguous project matches", async () => {
    const router = createOnCallRouter({
      projects: {
        resolveProject: vi.fn().mockResolvedValue({
          type: "ambiguous",
          candidates: [
            { id: "frontend-web", name: "Frontend Web" },
            { id: "frontend-mobile", name: "Frontend Mobile" },
          ],
        }),
        rememberActiveProject: vi.fn(),
      } as never,
      sessions: {
        getOrCreateSession: vi.fn().mockResolvedValue(buildSession()),
      } as never,
      memory: {
        appendEvent: vi.fn().mockResolvedValue(undefined),
      } as never,
    });

    const response = await router.processInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat-1",
      body: "continue frontend",
      timestampMs: Date.now(),
    });

    expect(response.outcome.type).toBe("needs_clarification");
    if (response.outcome.type === "needs_clarification") {
      expect(response.outcome.candidates).toHaveLength(2);
    }
  });
});
