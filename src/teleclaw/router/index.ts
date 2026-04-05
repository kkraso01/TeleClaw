import { resolveOnCallIntent } from "../intent/index.js";
import { createOnCallMemoryStore, type OnCallMemoryStore } from "../memory/index.js";
import {
  canAttachRuntime,
  canBindProject,
  canStartRuntime,
  explainPolicyFailure,
  explainRuntimePolicyFailure,
  requireExecutionContext,
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

const defaultAdapter = createOpenHandsAdapter({
  baseUrl: process.env.OPENHANDS_ENDPOINT ?? "http://localhost:3001",
  apiKey: process.env.ONCALLDEV_OPENHANDS_API_KEY,
  llmBaseUrl: process.env.LLM_BASE_URL,
  llmApiKey: process.env.LLM_API_KEY,
  model: process.env.LLM_MODEL,
});

type RuntimeIntent = "start" | "stop" | "restart" | "status" | null;

function resolveDefaultReplyMode(requested: "text" | "voice"): "text" | "voice" {
  if (requested === "voice") {
    return "voice";
  }
  return process.env.DEFAULT_REPLY_MODE === "voice" ? "voice" : "text";
}

function createEvent<TEvent extends OnCallMemoryEvent>(event: Omit<TEvent, "id">): TEvent {
  return {
    ...event,
    id: `mem:${event.sessionId}:${event.type}:${event.atMs}:${Math.random().toString(36).slice(2, 8)}`,
  } as TEvent;
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

  return askedForSummary
    ? `Summary for ${params.projectName}:\n${summary}`
    : `Status for ${params.projectName} (${params.session.currentPhase}):\n${summary}`;
}

function createRuntimeStatusText(params: {
  projectName: string;
  status: OnCallRuntimeStatus;
  containerId: string | null;
  containerName: string | null;
  runtimeFamily: string | null;
}): string {
  const containerLine = params.containerId
    ? `Container: ${params.containerName ?? "(unnamed)"} [${params.containerId}]`
    : "Container: unbound";
  return `${params.projectName} runtime is ${params.status}. ${containerLine}. Runtime family: ${params.runtimeFamily ?? "unknown"}.`;
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
  });
}

export function createOnCallRouter(deps: OnCallRouterDeps = {}): OnCallRouter {
  const projects = deps.projects ?? createOnCallProjectRegistry();
  const sessions = deps.sessions ?? createOnCallSessionManager();
  const memory = deps.memory ?? createOnCallMemoryStore();
  const worker = deps.worker ?? defaultAdapter;
  const voice = deps.voice ?? createOnCallVoiceService();
  const runtime = deps.runtime ?? createOnCallRuntimeController({ projects });

  async function processNormalized(input: OnCallInput): Promise<OnCallRouterResponse> {
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
      eventType: "runtime.ensure_requested",
      status: project.runtimeStatus,
      message: "Runtime ensure requested before execution.",
      containerId: project.containerId,
      containerName: project.containerName,
    });

    let ensuredRuntime;
    try {
      ensuredRuntime = await runtime.ensureProjectRuntime(project);
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

    const validation = await runtime.validateProjectRuntime(project);
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
    try {
      result = await invokeWorker({
        action: intent.action,
        worker,
        projectId: project.id,
        text: intent.instruction,
        context: workerContext,
      });
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
