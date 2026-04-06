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

function buildRouter(overrides?: { transcribeAudio?: ReturnType<typeof vi.fn> }) {
  const appendEvent = vi.fn().mockResolvedValue(undefined);
  const project = baseProject();
  const router = createOnCallRouter({
    projects: {
      resolveProject: vi.fn().mockResolvedValue({ type: "resolved", via: "id", project }),
      rememberActiveProject: vi.fn().mockResolvedValue(undefined),
      getProjectById: vi.fn().mockResolvedValue(project),
    } as never,
    sessions: {
      getOrCreateSession: vi.fn().mockResolvedValue({
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
      }),
      bindProject: vi.fn().mockResolvedValue(null),
      bindWorker: vi.fn().mockResolvedValue(null),
      appendRecentAction: vi.fn().mockResolvedValue(null),
      setSummary: vi.fn().mockResolvedValue(null),
      setPhase: vi.fn().mockResolvedValue(null),
      setStructuredState: vi.fn().mockResolvedValue(null),
      setPendingApproval: vi.fn().mockResolvedValue(null),
    } as never,
    memory: {
      appendEvent,
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
      runTask: vi.fn().mockResolvedValue({ status: "ok", text: "done" }),
      resume: vi.fn().mockResolvedValue({ status: "ok", text: "done" }),
      getStatus: vi.fn().mockResolvedValue({ status: "ok", text: "done" }),
      summarize: vi.fn().mockResolvedValue({ status: "ok", text: "done" }),
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
      startProjectRuntime: vi.fn(),
      stopProjectRuntime: vi.fn(),
      restartProjectRuntime: vi.fn(),
      getProjectRuntime: vi.fn(),
    } as never,
    voice: {
      transcribeAudio:
        overrides?.transcribeAudio ??
        vi.fn().mockResolvedValue({
          text: "status billing",
          provider: "faster-whisper",
          metadata: { quality: "high", confidence: 0.92, language: "en" },
        }),
      synthesizeSpeech: vi.fn().mockRejectedValue(new Error("tts disabled")),
    } as never,
  });
  return { router, appendEvent };
}

describe("TeleClaw voice flow", () => {
  it("persists transcript metadata when voice transcription succeeds", async () => {
    const { router, appendEvent } = buildRouter();

    await router.processVoiceInbound({
      channel: "telegram",
      userId: "u1",
      chatId: "chat",
      audioUrl: "https://voice.test/1.ogg",
      timestampMs: Date.now(),
    });

    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "inbound_voice_transcript",
        provider: "faster-whisper",
        metadata: expect.objectContaining({ quality: "high", confidence: 0.92 }),
      }),
    );
  });
});
