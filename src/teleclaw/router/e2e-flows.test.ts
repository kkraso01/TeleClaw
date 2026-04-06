import { describe, expect, it, vi } from "vitest";
import { createOnCallRouter } from "./index.js";

function baseProject() {
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
    bootstrapStatus: "ready",
    bootstrapError: null,
    repoUrl: null,
    repoStatus: "clean",
    branch: "main",
    lastRepoSyncAt: null,
    repoError: null,
    executionProfile: {
      installCommand: "pnpm install",
      testCommand: "pnpm test",
      lintCommand: "pnpm lint",
      buildCommand: "pnpm build",
      runCommand: "pnpm dev",
      packageManager: "pnpm",
      preferredShell: "bash",
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function baseSession() {
  return {
    sessionId: "session:chat",
    chatId: "chat",
    userId: "u1",
    activeProjectId: "billing",
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
    pendingApproval: null,
    lastActiveAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function standardRuntime() {
  const status = {
    status: "running",
    containerId: "ctr-billing",
    containerName: "teleclaw-billing",
    runtimeFamily: "node",
    workspacePath: `${process.cwd()}/workspace/billing`,
    checkedAt: new Date().toISOString(),
  };
  return {
    reconcileProjectRuntime: vi.fn().mockResolvedValue(status),
    ensureProjectRuntime: vi.fn().mockResolvedValue({ outcome: "runtime_reused", status }),
    validateProjectRuntime: vi.fn().mockResolvedValue({ ok: true, status }),
    startProjectRuntime: vi.fn(),
    stopProjectRuntime: vi.fn(),
    restartProjectRuntime: vi.fn(),
    getProjectRuntime: vi.fn(),
  };
}

function createScenarioRouter(overrides?: {
  session?: Record<string, unknown>;
  projectResolution?: unknown;
  workerResult?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  voice?: Record<string, unknown>;
}) {
  const project = baseProject();
  const session = { ...baseSession(), ...overrides?.session };
  const workerResult = {
    status: "ok",
    text: "Done with requested task.",
    ...overrides?.workerResult,
  };
  return createOnCallRouter({
    projects: {
      resolveProject: vi.fn().mockResolvedValue(
        overrides?.projectResolution ??
          ({
            type: "resolved",
            via: "id",
            project,
          } as const),
      ),
      rememberActiveProject: vi.fn().mockResolvedValue(undefined),
      getProjectById: vi.fn().mockResolvedValue(project),
    } as never,
    sessions: {
      getOrCreateSession: vi.fn().mockResolvedValue(session),
      bindProject: vi.fn().mockImplementation(async (_sessionId: string, projectId: string) => ({
        ...session,
        activeProjectId: projectId,
      })),
      bindWorker: vi.fn().mockResolvedValue(null),
      appendRecentAction: vi.fn().mockResolvedValue(null),
      setSummary: vi.fn().mockResolvedValue(null),
      setPhase: vi.fn().mockResolvedValue(null),
      setStructuredState: vi.fn().mockResolvedValue(null),
      setPendingApproval: vi.fn().mockResolvedValue(null),
    } as never,
    memory: {
      appendEvent: vi.fn().mockResolvedValue(undefined),
      mergeDurableFacts: vi.fn().mockResolvedValue({}),
      getSummary: vi.fn().mockResolvedValue(""),
      getStructuredState: vi.fn().mockResolvedValue({
        filesChanged: [],
        testsPassing: [],
        testsFailing: [],
        blockers: [],
      }),
      setSummary: vi.fn().mockResolvedValue(undefined),
      compactSessionMemory: vi.fn().mockResolvedValue({ compactedEvents: 0 }),
    } as never,
    worker: {
      runTask: vi.fn().mockResolvedValue(workerResult),
      resume: vi.fn().mockResolvedValue(workerResult),
      getStatus: vi.fn().mockResolvedValue(workerResult),
      summarize: vi.fn().mockResolvedValue(workerResult),
    } as never,
    runtime: { ...standardRuntime(), ...overrides?.runtime } as never,
    voice: {
      transcribeAudio: vi.fn().mockResolvedValue({
        text: "status billing",
        provider: "mock",
        metadata: { quality: "high" },
      }),
      synthesizeSpeech: vi.fn().mockResolvedValue({
        mediaUrl: "teleclaw://voice/1",
        provider: "mock-tts",
      }),
      ...overrides?.voice,
    } as never,
  });
}

describe("TeleClaw end-to-end journey scenarios", () => {
  it("starts work from a text request on active project", async () => {
    const router = createScenarioRouter();
    const response = await router.processInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat",
      body: "continue with billing fixes",
      timestampMs: Date.now(),
    });
    expect(response.outcome.type).toBe("success");
    expect(response.text).toContain("Done");
  });

  it("switches project when explicit project is requested", async () => {
    const router = createScenarioRouter({
      session: { activeProjectId: "legacy-app" },
      projectResolution: { type: "resolved", via: "alias", project: baseProject() },
    });
    const response = await router.processInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat",
      body: "continue the billing project",
      timestampMs: Date.now(),
    });
    expect(response.text).toContain("Switched to Billing");
  });

  it("asks for approval on risky requests", async () => {
    const router = createScenarioRouter();
    const response = await router.processInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat",
      body: "delete files in billing",
      timestampMs: Date.now(),
    });
    expect(response.outcome.type).toBe("approval_required");
    expect(response.text).toContain("I need your approval");
  });

  it("resumes execution for natural-language approval", async () => {
    const pendingApproval = {
      approvalId: "approval:1",
      sessionId: "session:chat",
      projectId: "billing",
      originalInstruction: "delete old temp files in billing",
      normalizedActionSummary: "delete old temp files in billing",
      riskReason: "Potentially destructive file deletion.",
      classification: {
        decision: "requires_approval",
        reason: "Potentially destructive file deletion.",
        matchedRule: "delete_files",
        riskLevel: "high",
        requiresExplicitApproval: true,
      },
      workerContextSnapshot: { workerType: "openhands", workerSessionId: null },
      runtimeContextSnapshot: {
        containerId: null,
        containerName: null,
        runtimeFamily: "node",
        workspacePath: `${process.cwd()}/workspace/billing`,
      },
      createdAt: new Date().toISOString(),
      status: "pending" as const,
    };
    const router = createScenarioRouter({ session: { pendingApproval } });
    const response = await router.processInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat",
      body: "go ahead",
      timestampMs: Date.now(),
    });
    expect(response.outcome.type).toBe("approval_resumed");
  });

  it("cancels execution for rejection", async () => {
    const pendingApproval = {
      approvalId: "approval:1",
      sessionId: "session:chat",
      projectId: "billing",
      originalInstruction: "delete old temp files in billing",
      normalizedActionSummary: "delete old temp files in billing",
      riskReason: "Potentially destructive file deletion.",
      classification: {
        decision: "requires_approval",
        reason: "Potentially destructive file deletion.",
        matchedRule: "delete_files",
        riskLevel: "high",
        requiresExplicitApproval: true,
      },
      workerContextSnapshot: { workerType: "openhands", workerSessionId: null },
      runtimeContextSnapshot: {
        containerId: null,
        containerName: null,
        runtimeFamily: "node",
        workspacePath: `${process.cwd()}/workspace/billing`,
      },
      createdAt: new Date().toISOString(),
      status: "pending" as const,
    };
    const router = createScenarioRouter({ session: { pendingApproval } });
    const response = await router.processInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat",
      body: "reject it",
      timestampMs: Date.now(),
    });
    expect(response.outcome.type).toBe("approval_rejected");
  });

  it("answers waiting-for-approval status from durable state", async () => {
    const pendingApproval = {
      approvalId: "approval:1",
      sessionId: "session:chat",
      projectId: "billing",
      originalInstruction: "delete old temp files in billing",
      normalizedActionSummary: "delete old temp files in billing",
      riskReason: "Potentially destructive file deletion.",
      classification: {
        decision: "requires_approval",
        reason: "Potentially destructive file deletion.",
        matchedRule: "delete_files",
        riskLevel: "high",
        requiresExplicitApproval: true,
      },
      workerContextSnapshot: { workerType: "openhands", workerSessionId: null },
      runtimeContextSnapshot: {
        containerId: null,
        containerName: null,
        runtimeFamily: "node",
        workspacePath: `${process.cwd()}/workspace/billing`,
      },
      createdAt: new Date().toISOString(),
      status: "pending" as const,
    };
    const router = createScenarioRouter({ session: { pendingApproval } });
    const response = await router.processInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat",
      body: "what are you waiting for?",
      timestampMs: Date.now(),
    });
    expect(response.outcome.type).toBe("approval_status");
  });

  it("routes voice note through normal execution path", async () => {
    const router = createScenarioRouter();
    const response = await router.processVoiceInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat",
      audioUrl: "https://voice.test/1.ogg",
      timestampMs: Date.now(),
    });
    expect(response.outcome.type).toBe("success");
  });

  it("returns clarification for weak transcripts instead of executing", async () => {
    const router = createScenarioRouter({
      voice: {
        transcribeAudio: vi.fn().mockResolvedValue({
          text: "maybe",
          provider: "whisper.cpp",
          metadata: { quality: "low", confidence: 0.1 },
        }),
      },
    });
    const response = await router.processVoiceInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat",
      audioUrl: "https://voice.test/weak.ogg",
      timestampMs: Date.now(),
    });
    expect(response.outcome.type).toBe("needs_clarification");
    expect(response.text).toContain("could not understand");
  });

  it("returns explicit fallback-to-text guidance when STT provider fails", async () => {
    const router = createScenarioRouter({
      voice: {
        transcribeAudio: vi.fn().mockResolvedValue({
          text: "",
          provider: "whisper.cpp",
          metadata: { quality: "missing", reason: "stt_provider_failure" },
        }),
      },
    });
    const response = await router.processVoiceInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat",
      audioUrl: "https://voice.test/failed.ogg",
      timestampMs: Date.now(),
    });
    expect(response.outcome.type).toBe("needs_clarification");
    expect(response.text).toContain("temporarily unavailable");
    expect(response.text).toContain("send the request as text");
  });

  it("falls back to text when voice reply generation fails", async () => {
    const router = createScenarioRouter({
      voice: {
        transcribeAudio: vi.fn().mockResolvedValue({ text: "continue billing", provider: "mock" }),
        synthesizeSpeech: vi.fn().mockRejectedValue(new Error("tts down")),
      },
    });
    const response = await router.processInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat",
      body: "continue billing and reply with voice",
      timestampMs: Date.now(),
    });
    expect(response.text).toContain("Voice reply was unavailable");
  });

  it("explains runtime missing clearly", async () => {
    const router = createScenarioRouter({
      runtime: {
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
      },
    });
    const response = await router.processInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat",
      body: "continue billing",
      timestampMs: Date.now(),
    });
    expect(response.outcome.type).toBe("runtime_missing");
    expect(response.text).toContain("restart the runtime");
  });

  it("asks user to clarify when project reference is ambiguous", async () => {
    const router = createScenarioRouter({
      projectResolution: {
        type: "ambiguous",
        candidates: [
          { id: "billing", name: "Billing" },
          { id: "billing-api", name: "Billing API" },
        ],
      },
    });
    const response = await router.processInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat",
      body: "continue billing",
      timestampMs: Date.now(),
    });
    expect(response.outcome.type).toBe("needs_clarification");
  });
});
