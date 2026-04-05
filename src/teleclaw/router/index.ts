import { resolveOnCallIntent } from "../intent/index.js";
import { createOnCallMemoryStore, type OnCallMemoryStore } from "../memory/index.js";
import {
  canBindProject,
  explainPolicyFailure,
  requireExecutionContext,
  validateWorkspacePath,
} from "../policy/index.js";
import { createOnCallProjectRegistry, type OnCallProjectRegistry } from "../projects/index.js";
import { createOnCallSessionManager, type OnCallSessionManager } from "../sessions/index.js";
import type { OnCallInput, OnCallRouteOutcome, OnCallWorkerResult } from "../types.js";
import {
  createOpenHandsAdapter,
  type OnCallWorkerContext,
  type OpenHandsAdapter,
} from "../worker/adapter.js";

export type OnCallRouterResponse = {
  text: string;
  replyMode: "text" | "voice";
  outcome: OnCallRouteOutcome;
};

export type OnCallRouter = {
  processInbound: (input: OnCallInput) => Promise<OnCallRouterResponse>;
};

type OnCallRouterDeps = {
  projects?: OnCallProjectRegistry;
  sessions?: OnCallSessionManager;
  memory?: OnCallMemoryStore;
  worker?: OpenHandsAdapter;
};

const defaultAdapter = createOpenHandsAdapter({
  baseUrl: process.env.OPENHANDS_ENDPOINT ?? "http://localhost:3001",
  apiKey: process.env.ONCALLDEV_OPENHANDS_API_KEY,
  llmBaseUrl: process.env.LLM_BASE_URL,
  llmApiKey: process.env.LLM_API_KEY,
  model: process.env.LLM_MODEL,
});

async function invokeWorker(params: {
  action: string;
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

export function createOnCallRouter(deps: OnCallRouterDeps = {}): OnCallRouter {
  const projects = deps.projects ?? createOnCallProjectRegistry();
  const sessions = deps.sessions ?? createOnCallSessionManager();
  const memory = deps.memory ?? createOnCallMemoryStore();
  const worker = deps.worker ?? defaultAdapter;

  return {
    async processInbound(input) {
      const intent = resolveOnCallIntent(input);
      const replyMode = intent.replyMode;
      const chatId = input.chatId ?? input.sessionKey ?? input.userId;
      const session = await sessions.getOrCreateSession(chatId, input.userId);
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
        return { text: outcome.text, replyMode, outcome };
      }

      const boundSession = await sessions.bindProject(session.sessionId, project.id);
      if (!boundSession || boundSession.activeProjectId !== project.id) {
        const outcome: OnCallRouteOutcome = {
          type: "invalid_project_binding",
          replyMode,
          text: "Failed to bind chat session to project context safely.",
          reason: "session_bind_failed",
        };
        return { text: outcome.text, replyMode, outcome };
      }

      await projects.rememberActiveProject(chatId, project.id);
      await sessions.bindWorker(boundSession.sessionId, { containerId: project.containerId });

      memory.appendEvent(boundSession, {
        atMs: input.timestampMs,
        type: "user",
        text: intent.instruction,
      });

      const workerContext: OnCallWorkerContext = {
        sessionId: boundSession.sessionId,
        workerSessionId: boundSession.workerBinding.workerSessionId,
        workspacePath: project.workspacePath,
        containerId: project.containerId,
        summary: boundSession.summary,
        structuredState: boundSession.structuredState,
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
        return { text: outcome.text, replyMode, outcome };
      }

      memory.appendEvent(boundSession, {
        atMs: Date.now(),
        type: "worker",
        text: result.text,
      });

      if (result.summary) {
        memory.updateSummary(boundSession, result.summary);
        await sessions.setSummary(boundSession.sessionId, result.summary);
      }

      if (result.workerSessionId) {
        await sessions.bindWorker(boundSession.sessionId, {
          workerSessionId: result.workerSessionId,
        });
      }

      await sessions.appendRecentAction(boundSession.sessionId, intent.action);

      const outcome: OnCallRouteOutcome = {
        type: "success",
        replyMode,
        projectId: project.id,
        projectName: project.name,
        sessionId: boundSession.sessionId,
        text: buildReply(result),
        execution: {
          action: intent.action,
          status: result.status,
        },
        summary: result.summary,
      };

      return {
        text: outcome.text,
        replyMode,
        outcome,
      };
    },
  };
}
