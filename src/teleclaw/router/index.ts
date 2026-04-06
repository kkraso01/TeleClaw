import {
  createPendingApproval,
  renderApprovalPrompt,
  renderPendingApprovalStatus,
} from "../approvals/index.js";
import { resolveOnCallIntent } from "../intent/index.js";
import { createOnCallMemoryStore, type OnCallMemoryStore } from "../memory/index.js";
import {
  canAttachRuntime,
  canBindProject,
  canBootstrapProject,
  canStartRuntime,
  classifyApprovalNeed,
  explainPolicyFailure,
  explainRuntimePolicyFailure,
  requireExecutionContext,
  validateProjectCreationInput,
  validateRepoUrl,
  validateWorkspacePath,
} from "../policy/index.js";
import { createOnCallProjectRegistry, type OnCallProjectRegistry } from "../projects/index.js";
import { createOnCallRuntimeController, type OnCallRuntimeController } from "../runtime/index.js";
import { createOnCallSessionManager, type OnCallSessionManager } from "../sessions/index.js";
import type {
  OnCallAction,
  OnCallInput,
  OnCallMemoryEvent,
  OnCallRouteOutcome,
  OnCallRuntimeEventType,
  OnCallRuntimeStatus,
  OnCallSessionState,
  OnCallStructuredState,
  OnCallVoiceSynthesisResult,
  OnCallWorkerProgressEvent,
  OnCallWorkerResult,
} from "../types.js";
import { createOnCallVoiceService, type OnCallVoiceService } from "../voice/index.js";
import {
  createOpenHandsAdapter,
  type OnCallWorkerContext,
  type OpenHandsAdapter,
} from "../worker/adapter.js";

export type OnCallRouterResponse = {
  text: string;
  replyMode: "text" | "voice";
  voiceReply?: OnCallVoiceSynthesisResult;
  outcome: OnCallRouteOutcome;
};

export type OnCallRouter = {
  processInbound: (input: OnCallInput) => Promise<OnCallRouterResponse>;
  processVoiceInbound: (
    input: Omit<OnCallInput, "body"> & { body?: string },
  ) => Promise<OnCallRouterResponse>;
};

type OnCallRouterDeps = {
  projects?: OnCallProjectRegistry;
  sessions?: OnCallSessionManager;
  memory?: OnCallMemoryStore;
  worker?: OpenHandsAdapter;
  voice?: OnCallVoiceService;
  runtime?: OnCallRuntimeController;
};

const defaultAdapter = createOpenHandsAdapter();

type RuntimeIntent = "start" | "stop" | "restart" | "status" | null;
type ProcessOptions = {
  bypassApprovalId?: string;
};

function resolveDefaultReplyMode(requested: "text" | "voice"): "text" | "voice" {
  if (requested === "voice") {
    return "voice";
  }
  return process.env.DEFAULT_REPLY_MODE === "voice" ? "voice" : "text";
}

function createEvent(event: Omit<OnCallMemoryEvent, "id">): OnCallMemoryEvent {
  return {
    ...event,
    id: `mem:${event.sessionId}:${event.type}:${event.atMs}:${Math.random().toString(36).slice(2, 8)}`,
  };
}

function resolveRuntimeIntent(instruction: string): RuntimeIntent {
  const normalized = instruction.trim().toLowerCase();
  if (/^(restart|reboot)\b/.test(normalized)) {
    return "restart";
  }
  if (/^(stop|shutdown|halt)\b/.test(normalized)) {
    return "stop";
  }
  if (/^(start|boot)\b/.test(normalized)) {
    return "start";
  }
  if (/(is .* running\??$|what container|container is|runtime status)/.test(normalized)) {
    return "status";
  }
  return null;
}

function normalizeProjectId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseProjectCreationIntent(
  instruction: string,
): { runtimeFamily: string; name: string } | null {
  const match = instruction
    .trim()
    .match(/^create (?:a )?new (python|node|generic|typescript|javascript) project called (.+)$/i);
  if (!match) {
    return null;
  }
  const familyRaw = match[1]?.toLowerCase() ?? "generic";
  const runtimeFamily =
    familyRaw === "typescript" || familyRaw === "javascript"
      ? "node"
      : familyRaw === "python"
        ? "python"
        : familyRaw;
  return { runtimeFamily, name: match[2]?.trim() ?? "" };
}

function parseRepoUrl(instruction: string): string | null {
  const match = instruction.match(/(https?:\/\/\S+|git@\S+)/i);
  return match?.[1] ?? null;
}

async function maybeSynthesizeVoiceReply(params: {
  responseText: string;
  replyMode: "text" | "voice";
  voice: OnCallVoiceService;
  sessionId: string;
  projectId?: string;
}): Promise<OnCallVoiceSynthesisResult | undefined> {
  if (params.replyMode !== "voice" || process.env.ENABLE_VOICE_REPLIES !== "1") {
    return undefined;
  }

  try {
    return await params.voice.synthesizeSpeech(params.responseText, {
      sessionId: params.sessionId,
      projectId: params.projectId,
    });
  } catch {
    return undefined;
  }
}

async function invokeWorker(params: {
  action: OnCallAction;
  worker: OpenHandsAdapter;
  projectId: string;
  text: string;
  context: OnCallWorkerContext;
}): Promise<OnCallWorkerResult> {
  const { action, worker, projectId, text, context } = params;
  switch (action) {
    case "resume":
      return await worker.resume(projectId, context);
    case "status":
      return await worker.getStatus(projectId, context);
    case "summarize":
      return await worker.summarize(projectId, context);
    default:
      return await worker.runTask(projectId, text, context);
  }
}

function buildReply(result: OnCallWorkerResult): string {
  if (result.status === "error") {
    return `OpenHands error: ${result.text}`;
  }
  if (result.status === "busy") {
    return `Working: ${result.text}`;
  }
  return result.text;
}

function createMemoryBackedStatusText(params: {
  summary: string;
  session: OnCallSessionState;
  action: OnCallAction;
  projectName: string;
  structuredState: OnCallStructuredState;
}): string | null {
  const summary = params.summary.trim();
  const askedForSummary = params.action === "summarize";
  const askedForStatus = params.action === "status";

  if (!askedForSummary && !askedForStatus) {
    return null;
  }
  if (!summary) {
    return null;
  }

  const filesLine = params.structuredState.filesChanged?.length
    ? `Changed files: ${params.structuredState.filesChanged.slice(-8).join(", ")}`
    : "Changed files: none captured yet";
  const testsLine =
    params.structuredState.lastTestRunStatus &&
    params.structuredState.lastTestRunStatus !== "unknown"
      ? `Last test run: ${params.structuredState.lastTestRunStatus}`
      : "Last test run: unknown";
  const blockerLine = params.structuredState.currentBlocker
    ? `Blocker: ${params.structuredState.currentBlocker}`
    : "Blocker: none recorded";
  const nextStepLine = params.structuredState.nextSuggestedStep
    ? `Next step: ${params.structuredState.nextSuggestedStep}`
    : "Next step: not recorded";

  return askedForSummary
    ? `Summary for ${params.projectName}:\n${summary}\n${filesLine}\n${testsLine}\n${blockerLine}\n${nextStepLine}`
    : `Status for ${params.projectName} (${params.session.currentPhase}):\n${summary}\n${filesLine}\n${testsLine}\n${blockerLine}\n${nextStepLine}`;
}

async function persistWorkerResultState(params: {
  sessions: OnCallSessionManager;
  memory: OnCallMemoryStore;
  sessionId: string;
  projectId: string;
  result: OnCallWorkerResult;
}): Promise<void> {
  await params.sessions.setStructuredState(params.sessionId, {
    currentPhase: params.result.phase,
    currentBlocker: params.result.blockerReason,
    nextSuggestedStep: params.result.nextSuggestedStep,
    filesChanged: params.result.filesChanged,
    filesChangedSummary: params.result.filesChanged?.length
      ? `${params.result.filesChanged.length} file(s) changed`
      : undefined,
  });

  if (params.result.blockerReason) {
    await params.memory.appendEvent(
      createEvent({
        atMs: Date.now(),
        sessionId: params.sessionId,
        projectId: params.projectId,
        type: "worker_status_progress",
        progress: {
          atMs: Date.now(),
          kind: "worker_error",
          message: params.result.blockerReason,
          phase: "blocked",
          blockers: [params.result.blockerReason],
          nextSuggestedStep: params.result.nextSuggestedStep,
        },
      }),
    );
  }
}

function createRuntimeStatusText(params: {
  projectName: string;
  status: OnCallRuntimeStatus;
  containerId: string | null;
  containerName: string | null;
  runtimeFamily: string | null;
  runtimeError?: string;
}): string {
  const containerLine = params.containerId
    ? `Container: ${params.containerName ?? "(unnamed)"} [${params.containerId}]`
    : "Container: unbound";
  const errorLine = params.runtimeError ? ` Last error: ${params.runtimeError}.` : "";
  return `${params.projectName} runtime is ${params.status}. ${containerLine}. Runtime family: ${params.runtimeFamily ?? "unknown"}.${errorLine}`;
}

async function persistRuntimeEvent(params: {
  memory: OnCallMemoryStore;
  sessionId: string;
  projectId: string;
  eventType: OnCallRuntimeEventType;
  status: OnCallRuntimeStatus;
  message: string;
  containerId?: string | null;
  containerName?: string | null;
}): Promise<void> {
  await params.memory.appendEvent(
    createEvent({
      atMs: Date.now(),
      sessionId: params.sessionId,
      projectId: params.projectId,
      type: "runtime_event",
      eventType: params.eventType,
      status: params.status,
      message: params.message,
      containerId: params.containerId,
      containerName: params.containerName,
    }),
  );
}

async function persistProgress(params: {
  memory: OnCallMemoryStore;
  sessionId: string;
  projectId: string;
  sessions: OnCallSessionManager;
  event: OnCallWorkerProgressEvent;
}): Promise<void> {
  const inferredInstallStatus =
    params.event.kind === "dependency_install"
      ? "running"
      : params.event.kind === "worker_error"
        ? "failed"
        : undefined;
  const inferredTestStatus =
    params.event.kind === "testing_started"
      ? "running"
      : params.event.kind === "tests_passed"
        ? "passed"
        : params.event.kind === "tests_failed"
          ? "failed"
          : undefined;

  await params.memory.appendEvent(
    createEvent({
      atMs: params.event.atMs,
      sessionId: params.sessionId,
      projectId: params.projectId,
      type: "worker_status_progress",
      progress: params.event,
    }),
  );

  await params.sessions.appendRecentAction(params.sessionId, `progress:${params.event.kind}`);

  await params.sessions.setStructuredState(params.sessionId, {
    currentPhase: params.event.phase,
    lastWorkerAction: params.event.kind,
    nextSuggestedStep: params.event.nextSuggestedStep,
    filesChanged: params.event.filesChanged,
    testsPassing: params.event.testsPassing,
    testsFailing: params.event.testsFailing,
    blockers: params.event.blockers,
    installStatus: inferredInstallStatus,
    lastTestRunStatus: inferredTestStatus,
    currentBlocker: params.event.blockers?.[0],
    filesChangedSummary: params.event.filesChanged?.length
      ? `${params.event.filesChanged.length} file(s) changed`
      : undefined,
  });
}

export function createOnCallRouter(deps: OnCallRouterDeps = {}): OnCallRouter {
  const projects = deps.projects ?? createOnCallProjectRegistry();
  const sessions = deps.sessions ?? createOnCallSessionManager();
  const memory = deps.memory ?? createOnCallMemoryStore();
  const worker = deps.worker ?? defaultAdapter;
  const voice = deps.voice ?? createOnCallVoiceService();
  const runtime = deps.runtime ?? createOnCallRuntimeController({ projects });

  async function processNormalized(
    input: OnCallInput,
    options: ProcessOptions = {},
  ): Promise<OnCallRouterResponse> {
    const intent = resolveOnCallIntent(input);
    const runtimeIntent = resolveRuntimeIntent(intent.instruction);
    const replyMode = resolveDefaultReplyMode(intent.replyMode);
    const chatId = input.chatId ?? input.sessionKey ?? input.userId;
    const session = await sessions.getOrCreateSession(chatId, input.userId);

    await memory.appendEvent(
      createEvent({
        atMs: input.timestampMs,
        sessionId: session.sessionId,
        projectId: session.activeProjectId ?? undefined,
        type: "inbound_user_message",
        text: intent.instruction,
        channel: "telegram",
        userId: input.userId,
      }),
    );

    const activeApproval = session.pendingApproval ?? null;
    const activePendingApproval = activeApproval?.status === "pending" ? activeApproval : null;

    if (intent.approvalIntent.type === "status_query") {
      const statusResponse = renderPendingApprovalStatus(activePendingApproval);
      const outcome: OnCallRouteOutcome = {
        type: "approval_status",
        replyMode,
        text: statusResponse.text,
        pendingApproval: activePendingApproval
          ? {
              projectId: activePendingApproval.projectId,
              approvalId: activePendingApproval.approvalId,
              reason: activePendingApproval.riskReason,
              actionSummary: activePendingApproval.normalizedActionSummary,
              requestedAt: activePendingApproval.createdAt,
              status: activePendingApproval.status,
            }
          : null,
      };
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: session.sessionId,
          projectId: activePendingApproval?.projectId,
          type: "teleclaw_event",
          eventType: "approval_query_answered",
          message: statusResponse.text,
        }),
      );
      return { text: statusResponse.text, replyMode, outcome };
    }

    if (intent.approvalIntent.type === "decision") {
      if (intent.approvalIntent.ambiguous || !intent.approvalIntent.decision) {
        const text =
          'I could not tell if you meant approve or reject. Please reply with "approve" or "reject".';
        const outcome: OnCallRouteOutcome = {
          type: "needs_clarification",
          replyMode,
          text,
          candidates: [
            { id: "approve", name: "approve pending action" },
            { id: "reject", name: "reject pending action" },
          ],
        };
        return { text, replyMode, outcome };
      }

      if (!activePendingApproval) {
        const text = "There is no pending approval request to act on.";
        await memory.appendEvent(
          createEvent({
            atMs: Date.now(),
            sessionId: session.sessionId,
            type: "teleclaw_event",
            eventType: "approval_missing",
            message: text,
          }),
        );
        const outcome: OnCallRouteOutcome = { type: "approval_missing", replyMode, text };
        return { text, replyMode, outcome };
      }

      if (intent.approvalIntent.decision === "reject") {
        const decidedAt = new Date().toISOString();
        if ("setPendingApproval" in sessions && typeof sessions.setPendingApproval === "function") {
          await sessions.setPendingApproval(session.sessionId, {
            ...activePendingApproval,
            status: "rejected",
            decidedAt,
          });
        }
        await sessions.setPhase(session.sessionId, "blocked");
        await sessions.appendRecentAction(session.sessionId, "approval:rejected");
        await memory.appendEvent(
          createEvent({
            atMs: Date.now(),
            sessionId: session.sessionId,
            projectId: activePendingApproval.projectId,
            type: "approval_decision",
            decision: "rejected",
            reason: activePendingApproval.riskReason,
            matchedRule: activePendingApproval.classification.matchedRule,
          }),
        );
        await memory.appendEvent(
          createEvent({
            atMs: Date.now(),
            sessionId: session.sessionId,
            projectId: activePendingApproval.projectId,
            type: "teleclaw_event",
            eventType: "approval_rejected",
            message: `Approval rejected for action: ${activePendingApproval.normalizedActionSummary}`,
          }),
        );
        const text = `Understood — I canceled the pending action for ${activePendingApproval.projectId}.`;
        const outcome: OnCallRouteOutcome = {
          type: "approval_rejected",
          replyMode,
          text,
          projectId: activePendingApproval.projectId,
          approvalId: activePendingApproval.approvalId,
          actionSummary: activePendingApproval.normalizedActionSummary,
          requestedAt: activePendingApproval.createdAt,
        };
        return { text, replyMode, outcome };
      }

      if ("setPendingApproval" in sessions && typeof sessions.setPendingApproval === "function") {
        await sessions.setPendingApproval(session.sessionId, {
          ...activePendingApproval,
          status: "approved",
          decidedAt: new Date().toISOString(),
        });
      }
      await sessions.appendRecentAction(session.sessionId, "approval:granted");
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: session.sessionId,
          projectId: activePendingApproval.projectId,
          type: "approval_decision",
          decision: "granted",
          reason: activePendingApproval.riskReason,
          matchedRule: activePendingApproval.classification.matchedRule,
        }),
      );
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: session.sessionId,
          projectId: activePendingApproval.projectId,
          type: "teleclaw_event",
          eventType: "approval_granted",
          message: `Approval granted for action: ${activePendingApproval.normalizedActionSummary}`,
        }),
      );
      await sessions.setPhase(session.sessionId, "planning");
      const resumed = await processNormalized(
        {
          ...input,
          body: activePendingApproval.originalInstruction,
          transcript: undefined,
          timestampMs: Date.now(),
        },
        { bypassApprovalId: activePendingApproval.approvalId },
      );
      if ("setPendingApproval" in sessions && typeof sessions.setPendingApproval === "function") {
        await sessions.setPendingApproval(session.sessionId, {
          ...activePendingApproval,
          status: "resumed",
          decidedAt: new Date().toISOString(),
        });
      }
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: session.sessionId,
          projectId: activePendingApproval.projectId,
          type: "teleclaw_event",
          eventType: "approval_resumed",
          message: `Resumed action after approval: ${activePendingApproval.normalizedActionSummary}`,
        }),
      );
      const text =
        resumed.outcome.type === "success"
          ? `Approved and resumed: ${resumed.text}`
          : `Approval was granted, but resume failed: ${resumed.text}`;
      return {
        text,
        replyMode: resumed.replyMode,
        voiceReply: resumed.voiceReply,
        outcome: {
          type: "approval_resumed",
          replyMode: resumed.replyMode,
          text,
          projectId: activePendingApproval.projectId,
          approvalId: activePendingApproval.approvalId,
          resumedExecution: {
            status: resumed.outcome.type === "success" ? "ok" : "error",
            outcomeType: resumed.outcome.type,
          },
        },
      };
    }

    const projectCreateIntent = parseProjectCreationIntent(intent.instruction);
    if (projectCreateIntent) {
      const workspaceRoot = process.env.PROJECTS_ROOT ?? `${process.cwd()}/workspace`;
      const projectId = normalizeProjectId(projectCreateIntent.name);
      const workspacePath = `${workspaceRoot}/${projectId}`;
      const createPolicy = validateProjectCreationInput({
        name: projectCreateIntent.name,
        workspacePath,
      });
      if (createPolicy) {
        const text = explainPolicyFailure(createPolicy);
        await memory.appendEvent(
          createEvent({
            atMs: Date.now(),
            sessionId: session.sessionId,
            type: "policy_block",
            code: createPolicy.code,
            message: createPolicy.message,
          }),
        );
        return {
          text,
          replyMode,
          outcome: {
            type: "blocked_by_policy",
            replyMode,
            text,
            policy: createPolicy,
          },
        };
      }

      const created = await projects.createProject({
        id: projectId,
        name: projectCreateIntent.name,
        aliases: [projectCreateIntent.name],
        language: projectCreateIntent.runtimeFamily === "python" ? "py" : "ts",
        workspacePath,
        containerId: null,
        runtimeFamily: projectCreateIntent.runtimeFamily,
        defaultReplyMode: replyMode,
        status: "active",
      });
      const bootstrapped = await projects.bootstrapProject(created.id, {
        createWorkspace: true,
        detectRuntimeFamily: true,
        initRepoIfMissing: false,
      });

      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: session.sessionId,
          projectId: created.id,
          type: "teleclaw_event",
          eventType: "project.created",
          message: `Created project ${created.name}`,
          details: {
            projectId: created.id,
            runtimeFamily: created.runtimeFamily,
          },
        }),
      );
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: session.sessionId,
          projectId: created.id,
          type: "teleclaw_event",
          eventType: "project.bootstrapped",
          message: `Bootstrapped project ${created.name}`,
        }),
      );
      await sessions.bindProject(session.sessionId, created.id);
      await projects.rememberActiveProject(chatId, created.id);
      const active = bootstrapped ?? created;
      const text = `Created and bootstrapped project ${active.name} (${active.id}) at ${active.workspacePath}. Runtime family: ${active.runtimeFamily ?? "generic"}.`;
      return {
        text,
        replyMode,
        outcome: {
          type: "success",
          replyMode,
          projectId: active.id,
          projectName: active.name,
          sessionId: session.sessionId,
          text,
          execution: {
            action: "task",
            status: "ok",
            source: "runtime",
          },
        },
      };
    }

    await memory.appendEvent(
      createEvent({
        atMs: input.timestampMs,
        sessionId: session.sessionId,
        projectId: session.activeProjectId ?? undefined,
        type: "resolved_intent",
        action: intent.action,
        instruction: intent.instruction,
        projectRef: intent.projectRef,
        replyMode,
      }),
    );

    const projectResolution = await projects.resolveProject({
      projectRef: intent.projectRef ?? session.activeProjectId ?? undefined,
      chatId,
    });

    if (projectResolution.type === "ambiguous") {
      const outcome: OnCallRouteOutcome = {
        type: "needs_clarification",
        replyMode,
        text: "I found multiple matching projects. Please clarify which project to use.",
        candidates: projectResolution.candidates.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
        })),
      };
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: session.sessionId,
          type: "router_decision",
          outcomeType: outcome.type,
          text: outcome.text,
        }),
      );
      return {
        text: outcome.text,
        replyMode,
        outcome,
      };
    }

    if (projectResolution.type === "not_found") {
      const outcome: OnCallRouteOutcome = {
        type: "project_not_found",
        replyMode,
        text: intent.projectRef
          ? `I could not find a project named "${intent.projectRef}".`
          : "No active project is bound to this chat yet. Ask to switch to a project first.",
        requestedRef: intent.projectRef,
      };
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: session.sessionId,
          type: "router_decision",
          outcomeType: outcome.type,
          text: outcome.text,
        }),
      );
      return {
        text: outcome.text,
        replyMode,
        outcome,
      };
    }

    const project = projectResolution.project;
    const workspacePolicy = validateWorkspacePath(project);
    if (workspacePolicy) {
      const outcome: OnCallRouteOutcome = {
        type: "blocked_by_policy",
        replyMode,
        text: explainPolicyFailure(workspacePolicy),
        projectId: project.id,
        policy: workspacePolicy,
      };
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: session.sessionId,
          projectId: project.id,
          type: "policy_block",
          code: workspacePolicy.code,
          message: workspacePolicy.message,
        }),
      );
      return { text: outcome.text, replyMode, outcome };
    }

    const bindPolicy = canBindProject(session, project);
    if (bindPolicy) {
      const outcome: OnCallRouteOutcome = {
        type: "blocked_by_policy",
        replyMode,
        text: explainPolicyFailure(bindPolicy),
        projectId: project.id,
        policy: bindPolicy,
      };
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: session.sessionId,
          projectId: project.id,
          type: "policy_block",
          code: bindPolicy.code,
          message: bindPolicy.message,
        }),
      );
      return { text: outcome.text, replyMode, outcome };
    }

    const executionContextPolicy = requireExecutionContext(project);
    if (executionContextPolicy) {
      const outcome: OnCallRouteOutcome = {
        type: "blocked_by_policy",
        replyMode,
        text: explainPolicyFailure(executionContextPolicy),
        projectId: project.id,
        policy: executionContextPolicy,
      };
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: session.sessionId,
          projectId: project.id,
          type: "policy_block",
          code: executionContextPolicy.code,
          message: executionContextPolicy.message,
        }),
      );
      return { text: outcome.text, replyMode, outcome };
    }

    const previousProjectId = session.activeProjectId ?? undefined;
    const boundSession = await sessions.bindProject(session.sessionId, project.id);
    if (!boundSession || boundSession.activeProjectId !== project.id) {
      const outcome: OnCallRouteOutcome = {
        type: "invalid_project_binding",
        replyMode,
        text: "Failed to bind chat session to project context safely.",
        reason: "session_bind_failed",
      };
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: session.sessionId,
          projectId: project.id,
          type: "router_decision",
          outcomeType: outcome.type,
          text: outcome.text,
        }),
      );
      return { text: outcome.text, replyMode, outcome };
    }

    if (previousProjectId !== project.id) {
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: boundSession.sessionId,
          projectId: project.id,
          type: "project_switch",
          fromProjectId: previousProjectId,
          toProjectId: project.id,
        }),
      );
    }

    await projects.rememberActiveProject(chatId, project.id);

    const refreshedProject = (await projects.getProjectById(project.id)) ?? project;

    const lowerInstruction = intent.instruction.toLowerCase();
    if (lowerInstruction.includes("bootstrap")) {
      const bootstrapPolicy = canBootstrapProject(refreshedProject);
      if (bootstrapPolicy) {
        const text = explainPolicyFailure(bootstrapPolicy);
        return {
          text,
          replyMode,
          outcome: {
            type: "blocked_by_policy",
            replyMode,
            text,
            projectId: refreshedProject.id,
            policy: bootstrapPolicy,
          },
        };
      }
      const bootstrapped = await projects.bootstrapProject(refreshedProject.id, {
        createWorkspace: true,
        detectRuntimeFamily: true,
        initRepoIfMissing: false,
      });
      const text = bootstrapped
        ? `Bootstrap ${bootstrapped.bootstrapStatus} for ${bootstrapped.name}. Repo status: ${bootstrapped.repoStatus}.`
        : `Unable to bootstrap ${refreshedProject.name}.`;
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: boundSession.sessionId,
          projectId: refreshedProject.id,
          type: "teleclaw_event",
          eventType: "project.bootstrapped",
          message: text,
        }),
      );
      return {
        text,
        replyMode,
        outcome: {
          type: "success",
          replyMode,
          projectId: refreshedProject.id,
          projectName: refreshedProject.name,
          sessionId: boundSession.sessionId,
          text,
          execution: {
            action: "task",
            status: bootstrapped?.bootstrapStatus === "error" ? "error" : "ok",
            source: "runtime",
          },
        },
      };
    }

    if (lowerInstruction.includes("clone") && lowerInstruction.includes("repo")) {
      const repoUrl = parseRepoUrl(intent.instruction);
      if (!repoUrl) {
        return {
          text: "Please provide a repository URL to clone.",
          replyMode,
          outcome: {
            type: "worker_error",
            replyMode,
            text: "Repository URL missing.",
            projectId: refreshedProject.id,
          },
        };
      }
      const repoPolicy = validateRepoUrl(repoUrl);
      if (repoPolicy) {
        const text = explainPolicyFailure(repoPolicy);
        return {
          text,
          replyMode,
          outcome: {
            type: "blocked_by_policy",
            replyMode,
            text,
            projectId: refreshedProject.id,
            policy: repoPolicy,
          },
        };
      }
      const bootstrapped = await projects.bootstrapProject(refreshedProject.id, {
        createWorkspace: true,
        detectRuntimeFamily: true,
        repoUrl,
        cloneRepo: true,
      });
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: boundSession.sessionId,
          projectId: refreshedProject.id,
          type: "teleclaw_event",
          eventType: "repo.cloned",
          message: `Cloned ${repoUrl}`,
        }),
      );
      const text = bootstrapped
        ? `Cloned repo into ${bootstrapped.name}. Branch: ${bootstrapped.branch ?? "unknown"}.`
        : "Repo clone failed.";
      return {
        text,
        replyMode,
        outcome: {
          type: "success",
          replyMode,
          projectId: refreshedProject.id,
          projectName: refreshedProject.name,
          sessionId: boundSession.sessionId,
          text,
          execution: {
            action: "task",
            status: bootstrapped?.repoStatus === "error" ? "error" : "ok",
            source: "runtime",
          },
        },
      };
    }

    if (/what branch|repo clean|repo status|is .* repo clean/.test(lowerInstruction)) {
      const refreshed = await projects.refreshProjectRepoState(refreshedProject.id);
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: boundSession.sessionId,
          projectId: refreshedProject.id,
          type: "teleclaw_event",
          eventType: "repo.inspected",
          message: "Repo state inspected.",
        }),
      );
      const target = refreshed ?? refreshedProject;
      const text = `Repo status for ${target.name}: ${target.repoStatus}. Branch: ${target.branch ?? "unknown"}.`;
      return {
        text,
        replyMode,
        outcome: {
          type: "success",
          replyMode,
          projectId: target.id,
          projectName: target.name,
          sessionId: boundSession.sessionId,
          text,
          execution: {
            action: "status",
            status: "ok",
            source: "runtime",
          },
        },
      };
    }

    if (intent.action === "task" || intent.action === "resume") {
      const approval = classifyApprovalNeed(intent.instruction);
      const canBypassApproval =
        options.bypassApprovalId &&
        activeApproval?.approvalId === options.bypassApprovalId &&
        activeApproval.originalInstruction === intent.instruction;
      if (approval.decision !== "allowed" && !canBypassApproval) {
        const eventType = approval.decision === "blocked" ? "policy_block" : "approval_requested";
        if (eventType === "policy_block") {
          await memory.appendEvent(
            createEvent({
              atMs: Date.now(),
              sessionId: boundSession.sessionId,
              projectId: refreshedProject.id,
              type: "policy_block",
              code: "destructive_action_blocked",
              message: approval.reason,
            }),
          );
          const text = `Execution blocked by TeleClaw approval policy: ${approval.reason}`;
          return {
            text,
            replyMode,
            outcome: {
              type: "blocked_by_policy",
              replyMode,
              text,
              projectId: refreshedProject.id,
              policy: {
                code: "destructive_action_blocked",
                message: approval.reason,
              },
            },
          };
        }

        const pendingApproval = createPendingApproval({
          session: boundSession,
          projectId: refreshedProject.id,
          workspacePath: refreshedProject.workspacePath,
          runtimeFamily: refreshedProject.runtimeFamily,
          originalInstruction: intent.instruction,
          classification: approval,
        });
        if ("setPendingApproval" in sessions && typeof sessions.setPendingApproval === "function") {
          await sessions.setPendingApproval(boundSession.sessionId, pendingApproval);
        }
        await memory.appendEvent(
          createEvent({
            atMs: Date.now(),
            sessionId: boundSession.sessionId,
            projectId: refreshedProject.id,
            type: "approval_requested",
            approvalId: pendingApproval.approvalId,
            instruction: intent.instruction,
            reason: approval.reason,
            matchedRule: approval.matchedRule,
            riskLevel: approval.riskLevel,
            actionSummary: pendingApproval.normalizedActionSummary,
          }),
        );
        await sessions.appendRecentAction(boundSession.sessionId, "approval:requested");
        await sessions.setStructuredState(boundSession.sessionId, {
          currentBlocker: approval.reason,
          nextSuggestedStep: "Reply with approve or reject.",
        });
        await sessions.setPhase(boundSession.sessionId, "awaiting_approval");
        const text = renderApprovalPrompt(pendingApproval);
        return {
          text,
          replyMode,
          outcome: {
            type: "approval_required",
            replyMode,
            text,
            projectId: refreshedProject.id,
            approval,
            approvalId: pendingApproval.approvalId,
            actionSummary: pendingApproval.normalizedActionSummary,
            requestedAt: pendingApproval.createdAt,
          },
        };
      }
    }

    const runtimeStartPolicy = canStartRuntime(project);
    if (runtimeStartPolicy) {
      const outcome: OnCallRouteOutcome = {
        type: "blocked_by_policy",
        replyMode,
        text: explainRuntimePolicyFailure(runtimeStartPolicy),
        projectId: project.id,
        policy: runtimeStartPolicy,
      };
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: session.sessionId,
          projectId: project.id,
          type: "policy_block",
          code: runtimeStartPolicy.code,
          message: runtimeStartPolicy.message,
        }),
      );
      return { text: outcome.text, replyMode, outcome };
    }

    await persistRuntimeEvent({
      memory,
      sessionId: boundSession.sessionId,
      projectId: project.id,
      eventType: "runtime.inspect_started",
      status: refreshedProject.runtimeStatus,
      message: "Runtime inspection started.",
      containerId: refreshedProject.containerId,
      containerName: refreshedProject.containerName,
    });

    let reconciledRuntime;
    try {
      reconciledRuntime = await runtime.reconcileProjectRuntime(refreshedProject);
      await persistRuntimeEvent({
        memory,
        sessionId: boundSession.sessionId,
        projectId: project.id,
        eventType: reconciledRuntime.status === "unbound" ? "runtime.stale" : "runtime.reconciled",
        status: reconciledRuntime.status,
        message:
          reconciledRuntime.status === "unbound"
            ? "Runtime metadata was stale and has been reset."
            : "Runtime reconciliation succeeded.",
        containerId: reconciledRuntime.containerId,
        containerName: reconciledRuntime.containerName,
      });
    } catch (error) {
      const outcome: OnCallRouteOutcome = {
        type: "runtime_error",
        replyMode,
        text: `Runtime reconciliation failed: ${error instanceof Error ? error.message : "unknown runtime failure"}`,
        projectId: project.id,
        reason: "reconcile_failed",
      };
      await persistRuntimeEvent({
        memory,
        sessionId: boundSession.sessionId,
        projectId: project.id,
        eventType: "runtime.error",
        status: "error",
        message: outcome.text,
      });
      return { text: outcome.text, replyMode, outcome };
    }

    if (runtimeIntent === "status") {
      const runtimeText = createRuntimeStatusText({
        projectName: project.name,
        status: reconciledRuntime.status,
        containerId: reconciledRuntime.containerId,
        containerName: reconciledRuntime.containerName,
        runtimeFamily: reconciledRuntime.runtimeFamily,
        runtimeError: reconciledRuntime.error,
      });
      const outcome: OnCallRouteOutcome = {
        type: "success",
        replyMode,
        projectId: project.id,
        projectName: project.name,
        sessionId: boundSession.sessionId,
        text: runtimeText,
        execution: {
          action: intent.action,
          status: "ok",
          source: "runtime",
        },
        runtimeOutcome: "runtime_reused",
      };
      return { text: runtimeText, replyMode, outcome };
    }

    await persistRuntimeEvent({
      memory,
      sessionId: boundSession.sessionId,
      projectId: project.id,
      eventType: "runtime.ensure_requested",
      status: reconciledRuntime.status,
      message: "Runtime ensure requested before execution.",
      containerId: reconciledRuntime.containerId,
      containerName: reconciledRuntime.containerName,
    });

    let ensuredRuntime;
    try {
      ensuredRuntime = await runtime.ensureProjectRuntime(refreshedProject);
    } catch (error) {
      const outcome: OnCallRouteOutcome = {
        type: "runtime_error",
        replyMode,
        text: `Runtime controller failed: ${error instanceof Error ? error.message : "unknown runtime failure"}`,
        projectId: project.id,
        reason: "ensure_failed",
      };
      await persistRuntimeEvent({
        memory,
        sessionId: boundSession.sessionId,
        projectId: project.id,
        eventType: "runtime.error",
        status: "error",
        message: outcome.text,
      });
      return { text: outcome.text, replyMode, outcome };
    }

    await persistRuntimeEvent({
      memory,
      sessionId: boundSession.sessionId,
      projectId: project.id,
      eventType:
        ensuredRuntime.outcome === "runtime_started" ? "runtime.started" : "runtime.reused",
      status: ensuredRuntime.status.status,
      message:
        ensuredRuntime.outcome === "runtime_started"
          ? "Runtime started for project execution."
          : "Reused existing runtime binding.",
      containerId: ensuredRuntime.status.containerId,
      containerName: ensuredRuntime.status.containerName,
    });

    const attachPolicy = canAttachRuntime(project, ensuredRuntime.status);
    if (attachPolicy) {
      const outcome: OnCallRouteOutcome = {
        type: "runtime_invalid",
        replyMode,
        text: explainRuntimePolicyFailure(attachPolicy),
        projectId: project.id,
        status: ensuredRuntime.status.status,
        reason: "attach_policy_failed",
      };
      await persistRuntimeEvent({
        memory,
        sessionId: boundSession.sessionId,
        projectId: project.id,
        eventType: "runtime.validation_failed",
        status: ensuredRuntime.status.status,
        message: outcome.text,
        containerId: ensuredRuntime.status.containerId,
        containerName: ensuredRuntime.status.containerName,
      });
      return { text: outcome.text, replyMode, outcome };
    }

    const runtimeProject = (await projects.getProjectById(project.id)) ?? refreshedProject;
    const validation = await runtime.validateProjectRuntime(runtimeProject);
    if (!validation.ok) {
      const outcome: OnCallRouteOutcome = {
        type: "runtime_missing",
        replyMode,
        text: `Runtime unavailable: ${validation.reason}`,
        projectId: project.id,
        status: validation.status.status,
        reason: validation.reason,
      };
      await persistRuntimeEvent({
        memory,
        sessionId: boundSession.sessionId,
        projectId: project.id,
        eventType: "runtime.validation_failed",
        status: validation.status.status,
        message: outcome.text,
        containerId: validation.status.containerId,
        containerName: validation.status.containerName,
      });
      return { text: outcome.text, replyMode, outcome };
    }

    await sessions.bindWorker(boundSession.sessionId, {
      workerType: "openhands",
      containerId: validation.status.containerId,
      containerName: validation.status.containerName,
    });

    if (runtimeIntent) {
      let runtimeStatus = validation.status;
      if (runtimeIntent === "restart") {
        runtimeStatus = await runtime.restartProjectRuntime(project);
        await persistRuntimeEvent({
          memory,
          sessionId: boundSession.sessionId,
          projectId: project.id,
          eventType: "runtime.restarted",
          status: runtimeStatus.status,
          message: "Runtime restarted.",
          containerId: runtimeStatus.containerId,
          containerName: runtimeStatus.containerName,
        });
      } else if (runtimeIntent === "stop") {
        runtimeStatus = await runtime.stopProjectRuntime(project);
        await persistRuntimeEvent({
          memory,
          sessionId: boundSession.sessionId,
          projectId: project.id,
          eventType: "runtime.stopped",
          status: runtimeStatus.status,
          message: "Runtime stopped.",
          containerId: runtimeStatus.containerId,
          containerName: runtimeStatus.containerName,
        });
      } else if (runtimeIntent === "start") {
        runtimeStatus = await runtime.startProjectRuntime(project);
        await persistRuntimeEvent({
          memory,
          sessionId: boundSession.sessionId,
          projectId: project.id,
          eventType: "runtime.started",
          status: runtimeStatus.status,
          message: "Runtime started.",
          containerId: runtimeStatus.containerId,
          containerName: runtimeStatus.containerName,
        });
      }

      const runtimeText = createRuntimeStatusText({
        projectName: project.name,
        status: runtimeStatus.status,
        containerId: runtimeStatus.containerId,
        containerName: runtimeStatus.containerName,
        runtimeFamily: runtimeStatus.runtimeFamily,
      });
      const outcome: OnCallRouteOutcome = {
        type: "success",
        replyMode,
        projectId: project.id,
        projectName: project.name,
        sessionId: boundSession.sessionId,
        text: runtimeText,
        execution: {
          action: intent.action,
          status: "ok",
          source: "runtime",
        },
        runtimeOutcome: ensuredRuntime.outcome,
      };
      return { text: runtimeText, replyMode, outcome };
    }

    await memory.mergeDurableFacts(
      boundSession.sessionId,
      {
        preferredReplyMode: replyMode,
        preferredProjectId: project.id,
      },
      project.id,
    );

    const memorySummary = await memory.getSummary(boundSession.sessionId, project.id);
    const memoryState = await memory.getStructuredState(boundSession.sessionId, project.id);

    const memoryBackedText = createMemoryBackedStatusText({
      summary: memorySummary,
      session: boundSession,
      action: intent.action,
      projectName: project.name,
      structuredState: memoryState,
    });

    if (memoryBackedText) {
      const voiceReply = await maybeSynthesizeVoiceReply({
        responseText: memoryBackedText,
        replyMode,
        voice,
        sessionId: boundSession.sessionId,
        projectId: project.id,
      });
      const outcome: OnCallRouteOutcome = {
        type: "success",
        replyMode,
        projectId: project.id,
        projectName: project.name,
        sessionId: boundSession.sessionId,
        text: memoryBackedText,
        execution: {
          action: intent.action,
          status: "ok",
          source: "memory",
        },
        runtimeOutcome: ensuredRuntime.outcome,
        summary: memorySummary,
        voiceMediaUrl: voiceReply?.mediaUrl,
      };

      await sessions.appendRecentAction(boundSession.sessionId, `${intent.action}:memory`);
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: boundSession.sessionId,
          projectId: project.id,
          type: "outbound_reply",
          mode: voiceReply ? "voice" : "text",
          text: memoryBackedText,
          voiceMediaUrl: voiceReply?.mediaUrl,
        }),
      );
      return {
        text: memoryBackedText,
        replyMode,
        voiceReply,
        outcome,
      };
    }

    await memory.appendEvent(
      createEvent({
        atMs: Date.now(),
        sessionId: boundSession.sessionId,
        projectId: project.id,
        type: "worker_task_start",
        action: intent.action,
        instruction: intent.instruction,
      }),
    );

    const workerContext: OnCallWorkerContext = {
      projectId: project.id,
      sessionId: boundSession.sessionId,
      workerSessionId: boundSession.workerBinding.workerSessionId,
      workspacePath: project.workspacePath,
      containerId: validation.status.containerId,
      containerName: validation.status.containerName,
      runtimeFamily: validation.status.runtimeFamily,
      executionProfile: runtimeProject.executionProfile,
      repoMetadata: {
        repoUrl: runtimeProject.repoUrl,
        repoStatus: runtimeProject.repoStatus,
        branch: runtimeProject.branch,
      },
      bootstrapState: {
        bootstrapStatus: runtimeProject.bootstrapStatus,
        bootstrapError: runtimeProject.bootstrapError,
      },
      summary: memorySummary || boundSession.summary,
      structuredState: memoryState,
      onProgress: async (event) => {
        await persistProgress({
          memory,
          sessionId: boundSession.sessionId,
          projectId: project.id,
          sessions,
          event,
        });
      },
    };

    let result: OnCallWorkerResult;
    const normalizedInstruction = intent.instruction.toLowerCase();
    if (/\binstall\b/.test(normalizedInstruction)) {
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: boundSession.sessionId,
          projectId: project.id,
          type: "teleclaw_event",
          eventType: "execution.install_started",
          message: "Install requested.",
          details: {
            command: runtimeProject.executionProfile.installCommand,
          },
        }),
      );
      await sessions.setStructuredState(boundSession.sessionId, { installStatus: "running" });
    }
    if (/\btest(s)?\b/.test(normalizedInstruction)) {
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: boundSession.sessionId,
          projectId: project.id,
          type: "teleclaw_event",
          eventType: "execution.test_started",
          message: "Test run requested.",
          details: {
            command: runtimeProject.executionProfile.testCommand,
          },
        }),
      );
      await sessions.setPhase(boundSession.sessionId, "testing");
      await sessions.setStructuredState(boundSession.sessionId, { lastTestRunStatus: "running" });
    }
    if (/\bbuild\b/.test(normalizedInstruction)) {
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: boundSession.sessionId,
          projectId: project.id,
          type: "teleclaw_event",
          eventType: "execution.build_started",
          message: "Build requested.",
          details: {
            command: runtimeProject.executionProfile.buildCommand,
          },
        }),
      );
      await sessions.setStructuredState(boundSession.sessionId, { lastBuildStatus: "running" });
    }
    try {
      await sessions.setPhase(boundSession.sessionId, "planning");
      result = await invokeWorker({
        action: intent.action,
        worker,
        projectId: project.id,
        text: intent.instruction,
        context: workerContext,
      });
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: boundSession.sessionId,
          projectId: project.id,
          type: "teleclaw_event",
          eventType: "execution.test_finished",
          message: "Worker execution finished.",
          details: {
            status: result.status,
          },
        }),
      );
    } catch (error) {
      const outcome: OnCallRouteOutcome = {
        type: "worker_error",
        replyMode,
        text: `Worker execution failed: ${error instanceof Error ? error.message : "unknown error"}`,
        projectId: project.id,
      };
      await sessions.appendRecentAction(boundSession.sessionId, `worker_error:${intent.action}`);
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: boundSession.sessionId,
          projectId: project.id,
          type: "worker_status_progress",
          progress: {
            atMs: Date.now(),
            kind: "worker_error",
            message: outcome.text,
            phase: "blocked",
            blockers: [outcome.text],
          },
        }),
      );
      return { text: outcome.text, replyMode, outcome };
    }

    for (const progressEvent of result.progressEvents ?? []) {
      await persistProgress({
        memory,
        sessionId: boundSession.sessionId,
        projectId: project.id,
        sessions,
        event: progressEvent,
      });
    }
    await persistWorkerResultState({
      sessions,
      memory,
      sessionId: boundSession.sessionId,
      projectId: project.id,
      result,
    });

    if (/\binstall\b/.test(normalizedInstruction)) {
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: boundSession.sessionId,
          projectId: project.id,
          type: "teleclaw_event",
          eventType: "execution.install_finished",
          message: `Install finished with status ${result.status}.`,
        }),
      );
      await sessions.setStructuredState(boundSession.sessionId, {
        installStatus: result.status === "ok" ? "passed" : "failed",
      });
    }
    if (/\btest(s)?\b/.test(normalizedInstruction)) {
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: boundSession.sessionId,
          projectId: project.id,
          type: "teleclaw_event",
          eventType: "execution.test_finished",
          message: `Tests finished with status ${result.status}.`,
        }),
      );
      await sessions.setStructuredState(boundSession.sessionId, {
        lastTestRunStatus: result.status === "ok" ? "passed" : "failed",
      });
    }
    if (/\bbuild\b/.test(normalizedInstruction)) {
      await memory.appendEvent(
        createEvent({
          atMs: Date.now(),
          sessionId: boundSession.sessionId,
          projectId: project.id,
          type: "teleclaw_event",
          eventType: "execution.build_finished",
          message: `Build finished with status ${result.status}.`,
        }),
      );
      await sessions.setStructuredState(boundSession.sessionId, {
        lastBuildStatus: result.status === "ok" ? "passed" : "failed",
      });
    }

    await memory.appendEvent(
      createEvent({
        atMs: Date.now(),
        sessionId: boundSession.sessionId,
        projectId: project.id,
        type: "worker_summary",
        text: result.text,
      }),
    );

    if (result.summary) {
      await memory.setSummary(boundSession.sessionId, result.summary, project.id);
      await sessions.setSummary(boundSession.sessionId, result.summary);
      await sessions.setStructuredState(boundSession.sessionId, {
        lastWorkerAction: intent.action,
        lastSummarizedOutput: result.summary,
      });
    }

    if (result.workerSessionId) {
      await sessions.bindWorker(boundSession.sessionId, {
        workerSessionId: result.workerSessionId,
      });
    }

    await sessions.appendRecentAction(boundSession.sessionId, intent.action);

    if ((result.progressEvents ?? []).length >= 6) {
      await memory.compactSessionMemory(boundSession.sessionId, project.id);
    }

    const finalText = buildReply(result);
    await sessions.setPhase(boundSession.sessionId, result.phase ?? "reporting");
    const voiceReply = await maybeSynthesizeVoiceReply({
      responseText: finalText,
      replyMode,
      voice,
      sessionId: boundSession.sessionId,
      projectId: project.id,
    });

    const outcome: OnCallRouteOutcome = {
      type: "success",
      replyMode,
      projectId: project.id,
      projectName: project.name,
      sessionId: boundSession.sessionId,
      text: finalText,
      execution: {
        action: intent.action,
        status: result.status,
        source: "worker",
      },
      runtimeOutcome: ensuredRuntime.outcome,
      summary: result.summary,
      voiceMediaUrl: voiceReply?.mediaUrl,
    };

    await memory.appendEvent(
      createEvent({
        atMs: Date.now(),
        sessionId: boundSession.sessionId,
        projectId: project.id,
        type: "router_decision",
        outcomeType: outcome.type,
        text: outcome.text,
      }),
    );

    await memory.appendEvent(
      createEvent({
        atMs: Date.now(),
        sessionId: boundSession.sessionId,
        projectId: project.id,
        type: "outbound_reply",
        mode: voiceReply ? "voice" : "text",
        text: finalText,
        voiceMediaUrl: voiceReply?.mediaUrl,
      }),
    );

    return {
      text: outcome.text,
      replyMode,
      voiceReply,
      outcome,
    };
  }

  return {
    async processInbound(input) {
      return await processNormalized({
        ...input,
        inputType: input.inputType ?? "text",
      });
    },

    async processVoiceInbound(input) {
      const chatId = input.chatId ?? input.sessionKey ?? input.userId;
      const session = await sessions.getOrCreateSession(chatId, input.userId);
      await memory.appendEvent(
        createEvent({
          atMs: input.timestampMs,
          sessionId: session.sessionId,
          projectId: session.activeProjectId ?? undefined,
          type: "inbound_voice_message",
          audioUrl: input.audioUrl,
          userId: input.userId,
          provider: "telegram",
        }),
      );

      const transcript = input.transcript?.trim()
        ? {
            text: input.transcript.trim(),
            provider: "telegram-transcript",
          }
        : await voice.transcribeAudio({
            audioUrl: input.audioUrl ?? "unknown-audio",
          });

      await memory.appendEvent(
        createEvent({
          atMs: input.timestampMs,
          sessionId: session.sessionId,
          projectId: session.activeProjectId ?? undefined,
          type: "inbound_voice_transcript",
          text: transcript.text,
          provider: transcript.provider,
        }),
      );

      return await processNormalized({
        ...input,
        body: input.body ?? transcript.text,
        transcript: transcript.text,
        inputType: "voice",
      });
    },
  };
}
