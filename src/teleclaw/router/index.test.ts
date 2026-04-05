import { describe, expect, it, vi } from "vitest";
import { createOnCallRouter } from "./index.js";

function buildSession(activeProjectId: string | null = null) {
  return {
    sessionId: "session:chat-1",
    chatId: "chat-1",
    userId: "u1",
    activeProjectId,
    workerBinding: {
      workerType: "openhands",
      workerSessionId: null,
      containerId: null,
      containerName: null,
    },
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
    containerId: null,
    containerName: null,
    runtimeStatus: "unbound",
    runtimeFamily: "node",
    defaultReplyMode: "text",
    status: "active",
    lastRuntimeStartAt: null,
    lastRuntimeCheckAt: null,
    runtimeError: null,
    workspaceBootstrappedAt: null,
    workspaceBootstrapError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("createOnCallRouter runtime lifecycle", () => {
  it("ensures runtime and passes runtime context to worker", async () => {
    const worker = {
      runTask: vi.fn().mockResolvedValue({ status: "ok", text: "done" }),
      resume: vi.fn().mockResolvedValue({ status: "ok", text: "resumed" }),
      getStatus: vi.fn().mockResolvedValue({ status: "ok", text: "healthy" }),
      summarize: vi.fn().mockResolvedValue({ status: "ok", text: "summary" }),
    };
    const runtime = {
      reconcileProjectRuntime: vi.fn().mockResolvedValue({
        status: "running",
        containerId: "ctr-billing",
        containerName: "teleclaw-billing",
        runtimeFamily: "node",
        workspacePath: `${process.cwd()}/workspace/billing`,
        checkedAt: new Date().toISOString(),
      }),
      ensureProjectRuntime: vi.fn().mockResolvedValue({
        outcome: "runtime_started",
        status: {
          status: "running",
          containerId: "ctr-billing",
          containerName: "teleclaw-billing",
          runtimeFamily: "node",
          workspacePath: `${process.cwd()}/workspace/billing`,
          checkedAt: new Date().toISOString(),
        },
      }),
      validateProjectRuntime: vi.fn().mockResolvedValue({
        ok: true,
        status: {
          status: "running",
          containerId: "ctr-billing",
          containerName: "teleclaw-billing",
          runtimeFamily: "node",
          workspacePath: `${process.cwd()}/workspace/billing`,
          checkedAt: new Date().toISOString(),
        },
      }),
      startProjectRuntime: vi.fn(),
      stopProjectRuntime: vi.fn(),
      restartProjectRuntime: vi.fn(),
      getProjectRuntime: vi.fn(),
    };

    const sessions = {
      getOrCreateSession: vi.fn().mockResolvedValue(buildSession("billing")),
      bindProject: vi.fn().mockImplementation(async (_id, projectId) => buildSession(projectId)),
      bindWorker: vi.fn().mockResolvedValue(null),
      appendRecentAction: vi.fn().mockResolvedValue(null),
      setSummary: vi.fn().mockResolvedValue(null),
      setStructuredState: vi.fn().mockResolvedValue(null),
    };

    const router = createOnCallRouter({
      projects: {
        resolveProject: vi.fn().mockResolvedValue({
          type: "resolved",
          via: "id",
          project: buildResolvedProject(),
        }),
        rememberActiveProject: vi.fn().mockResolvedValue(undefined),
        getProjectById: vi.fn().mockResolvedValue(buildResolvedProject()),
      } as never,
      sessions: sessions as never,
      memory: {
        appendEvent: vi.fn().mockResolvedValue(undefined),
        mergeDurableFacts: vi.fn().mockResolvedValue({}),
        getSummary: vi.fn().mockResolvedValue(""),
        getStructuredState: vi.fn().mockResolvedValue({}),
        setSummary: vi.fn().mockResolvedValue(undefined),
        compactSessionMemory: vi.fn().mockResolvedValue({ compactedEvents: 0 }),
      } as never,
      worker: worker as never,
      runtime: runtime as never,
    });

    const response = await router.processInbound({
      channel: "telegram",
      userId: "user-1",
      chatId: "chat-1",
      body: "continue the billing api",
      timestampMs: Date.now(),
    });

    expect(response.outcome.type).toBe("success");
    expect(runtime.ensureProjectRuntime).toHaveBeenCalled();
    expect(runtime.validateProjectRuntime).toHaveBeenCalled();
    expect(worker.resume).toHaveBeenCalledWith(
      "billing",
      expect.objectContaining({
        containerId: "ctr-billing",
        containerName: "teleclaw-billing",
        runtimeFamily: "node",
      }),
    );
    expect(sessions.bindWorker).toHaveBeenCalledWith(
      "session:chat-1",
      expect.objectContaining({ containerId: "ctr-billing" }),
    );
  });

  it("blocks execution when runtime validation fails", async () => {
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
        getProjectById: vi.fn().mockResolvedValue(buildResolvedProject()),
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
      worker: worker as never,
      runtime: {
        reconcileProjectRuntime: vi.fn().mockResolvedValue({
          status: "running",
          containerId: "ctr-billing",
          containerName: "teleclaw-billing",
          runtimeFamily: "node",
          workspacePath: `${process.cwd()}/workspace/billing`,
          checkedAt: new Date().toISOString(),
        }),
        ensureProjectRuntime: vi.fn().mockResolvedValue({
          outcome: "runtime_reused",
          status: {
            status: "running",
            containerId: "ctr-billing",
            containerName: "teleclaw-billing",
            runtimeFamily: "node",
            workspacePath: `${process.cwd()}/workspace/billing`,
            checkedAt: new Date().toISOString(),
          },
        }),
        validateProjectRuntime: vi.fn().mockResolvedValue({
          ok: false,
          reason: "container_gone",
          status: {
            status: "error",
            containerId: null,
            containerName: null,
            runtimeFamily: "node",
            workspacePath: `${process.cwd()}/workspace/billing`,
            checkedAt: new Date().toISOString(),
          },
        }),
        startProjectRuntime: vi.fn(),
        stopProjectRuntime: vi.fn(),
        restartProjectRuntime: vi.fn(),
        getProjectRuntime: vi.fn(),
      } as never,
    });

    const response = await router.processInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat-1",
      body: "continue billing",
      timestampMs: Date.now(),
    });

    expect(response.outcome.type).toBe("runtime_missing");
    expect(worker.resume).not.toHaveBeenCalled();
    expect(worker.runTask).not.toHaveBeenCalled();
  });

  it("handles runtime restart natural-language path without worker call", async () => {
    const worker = {
      runTask: vi.fn(),
      resume: vi.fn(),
      getStatus: vi.fn(),
      summarize: vi.fn(),
    };
    const runtime = {
      reconcileProjectRuntime: vi.fn().mockResolvedValue({
        status: "running",
        containerId: "ctr-billing",
        containerName: "teleclaw-billing",
        runtimeFamily: "node",
        workspacePath: `${process.cwd()}/workspace/billing`,
        checkedAt: new Date().toISOString(),
      }),
      ensureProjectRuntime: vi.fn().mockResolvedValue({
        outcome: "runtime_reused",
        status: {
          status: "running",
          containerId: "ctr-billing",
          containerName: "teleclaw-billing",
          runtimeFamily: "node",
          workspacePath: `${process.cwd()}/workspace/billing`,
          checkedAt: new Date().toISOString(),
        },
      }),
      validateProjectRuntime: vi.fn().mockResolvedValue({
        ok: true,
        status: {
          status: "running",
          containerId: "ctr-billing",
          containerName: "teleclaw-billing",
          runtimeFamily: "node",
          workspacePath: `${process.cwd()}/workspace/billing`,
          checkedAt: new Date().toISOString(),
        },
      }),
      restartProjectRuntime: vi.fn().mockResolvedValue({
        status: "running",
        containerId: "ctr-billing",
        containerName: "teleclaw-billing",
        runtimeFamily: "node",
        workspacePath: `${process.cwd()}/workspace/billing`,
        checkedAt: new Date().toISOString(),
      }),
      startProjectRuntime: vi.fn(),
      stopProjectRuntime: vi.fn(),
      getProjectRuntime: vi.fn(),
    };

    const router = createOnCallRouter({
      projects: {
        resolveProject: vi.fn().mockResolvedValue({
          type: "resolved",
          via: "id",
          project: buildResolvedProject(),
        }),
        rememberActiveProject: vi.fn().mockResolvedValue(undefined),
        getProjectById: vi.fn().mockResolvedValue(buildResolvedProject()),
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
      worker: worker as never,
      runtime: runtime as never,
    });

    const response = await router.processInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat-1",
      body: "restart the billing project",
      timestampMs: Date.now(),
    });

    expect(response.outcome.type).toBe("success");
    expect(runtime.restartProjectRuntime).toHaveBeenCalled();
    expect(worker.runTask).not.toHaveBeenCalled();
  });

  it("persists runtime lifecycle memory events", async () => {
    const appendEvent = vi.fn().mockResolvedValue(undefined);

    const router = createOnCallRouter({
      projects: {
        resolveProject: vi.fn().mockResolvedValue({
          type: "resolved",
          via: "id",
          project: buildResolvedProject(),
        }),
        rememberActiveProject: vi.fn().mockResolvedValue(undefined),
        getProjectById: vi.fn().mockResolvedValue(buildResolvedProject()),
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
        runTask: vi.fn().mockResolvedValue({ status: "ok", text: "done" }),
        resume: vi.fn().mockResolvedValue({ status: "ok", text: "resumed" }),
        getStatus: vi.fn().mockResolvedValue({ status: "ok", text: "status" }),
        summarize: vi.fn().mockResolvedValue({ status: "ok", text: "summary" }),
      } as never,
      runtime: {
        reconcileProjectRuntime: vi.fn().mockResolvedValue({
          status: "running",
          containerId: "ctr-billing",
          containerName: "teleclaw-billing",
          runtimeFamily: "node",
          workspacePath: `${process.cwd()}/workspace/billing`,
          checkedAt: new Date().toISOString(),
        }),
        ensureProjectRuntime: vi.fn().mockResolvedValue({
          outcome: "runtime_started",
          status: {
            status: "running",
            containerId: "ctr-billing",
            containerName: "teleclaw-billing",
            runtimeFamily: "node",
            workspacePath: `${process.cwd()}/workspace/billing`,
            checkedAt: new Date().toISOString(),
          },
        }),
        validateProjectRuntime: vi.fn().mockResolvedValue({
          ok: true,
          status: {
            status: "running",
            containerId: "ctr-billing",
            containerName: "teleclaw-billing",
            runtimeFamily: "node",
            workspacePath: `${process.cwd()}/workspace/billing`,
            checkedAt: new Date().toISOString(),
          },
        }),
        startProjectRuntime: vi.fn(),
        stopProjectRuntime: vi.fn(),
        restartProjectRuntime: vi.fn(),
        getProjectRuntime: vi.fn(),
      } as never,
    });

    await router.processInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat-1",
      body: "continue billing",
      timestampMs: Date.now(),
    });

    expect(
      appendEvent.mock.calls.some(
        (call) =>
          call[0]?.type === "runtime_event" && call[0]?.eventType === "runtime.ensure_requested",
      ),
    ).toBe(true);
    expect(
      appendEvent.mock.calls.some(
        (call) => call[0]?.type === "runtime_event" && call[0]?.eventType === "runtime.started",
      ),
    ).toBe(true);
  });
});
