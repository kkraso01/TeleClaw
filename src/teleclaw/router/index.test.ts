import { describe, expect, it, vi } from "vitest";
import { createOnCallRouter } from "./index.js";

describe("createOnCallRouter", () => {
  it("uses active project when no project is named", async () => {
    const projects = {
      resolveProject: vi.fn().mockResolvedValue({
        type: "resolved",
        via: "recent",
        project: {
          id: "frontend",
          name: "Frontend",
          aliases: ["frontend"],
          language: "ts",
          workspacePath: `${process.cwd()}/workspace/frontend`,
          containerId: "ctr-front",
          runtimeFamily: "node",
          defaultReplyMode: "text",
          status: "active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      rememberActiveProject: vi.fn().mockResolvedValue(undefined),
    };
    const sessions = {
      getOrCreateSession: vi.fn().mockResolvedValue({
        sessionId: "session:chat-1",
        chatId: "chat-1",
        userId: "user-1",
        activeProjectId: "frontend",
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
      }),
      bindProject: vi.fn().mockImplementation(async (_id, projectId) => ({
        sessionId: "session:chat-1",
        chatId: "chat-1",
        userId: "user-1",
        activeProjectId: projectId,
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
      })),
      bindWorker: vi.fn().mockResolvedValue(null),
      appendRecentAction: vi.fn().mockResolvedValue(null),
      setSummary: vi.fn().mockResolvedValue(null),
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
      projectRef: "frontend",
    });
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
        getOrCreateSession: vi.fn().mockResolvedValue({
          sessionId: "session:chat-1",
          chatId: "chat-1",
          userId: "u1",
          activeProjectId: null,
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
        }),
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

  it("rejects disallowed workspace path", async () => {
    const router = createOnCallRouter({
      projects: {
        resolveProject: vi.fn().mockResolvedValue({
          type: "resolved",
          via: "id",
          project: {
            id: "backend",
            name: "Backend",
            aliases: ["backend"],
            language: "ts",
            workspacePath: "/etc",
            containerId: "container-backend",
            runtimeFamily: "node",
            defaultReplyMode: "text",
            status: "active",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
        rememberActiveProject: vi.fn(),
      } as never,
      sessions: {
        getOrCreateSession: vi.fn().mockResolvedValue({
          sessionId: "session:chat-1",
          chatId: "chat-1",
          userId: "u1",
          activeProjectId: null,
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
        }),
      } as never,
    });

    const response = await router.processInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat-1",
      body: "status backend",
      timestampMs: Date.now(),
    });

    expect(response.outcome.type).toBe("blocked_by_policy");
  });

  it("explicit switch updates active project", async () => {
    const bindProject = vi.fn().mockImplementation(async (_id, projectId) => ({
      sessionId: "session:chat-1",
      chatId: "chat-1",
      userId: "u1",
      activeProjectId: projectId,
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
    }));

    const router = createOnCallRouter({
      projects: {
        resolveProject: vi.fn().mockResolvedValue({
          type: "resolved",
          via: "alias",
          project: {
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
          },
        }),
        rememberActiveProject: vi.fn().mockResolvedValue(undefined),
      } as never,
      sessions: {
        getOrCreateSession: vi.fn().mockResolvedValue({
          sessionId: "session:chat-1",
          chatId: "chat-1",
          userId: "u1",
          activeProjectId: "frontend",
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
        }),
        bindProject,
        bindWorker: vi.fn().mockResolvedValue(null),
        appendRecentAction: vi.fn().mockResolvedValue(null),
        setSummary: vi.fn().mockResolvedValue(null),
      } as never,
      worker: {
        runTask: vi.fn().mockResolvedValue({ status: "ok", text: "switched" }),
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

    expect(bindProject).toHaveBeenCalledWith("session:chat-1", "billing");
  });
});
