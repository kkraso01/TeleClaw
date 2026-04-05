import { resolveOnCallIntent } from "../intent/index.js";
import { createOnCallMemoryStore, type OnCallMemoryStore } from "../memory/index.js";
import { assertOnCallProjectBoundary } from "../policy/index.js";
import { createOnCallProjectResolver, type OnCallProjectResolver } from "../projects/index.js";
import { createOnCallSessionStore, type OnCallSessionStore } from "../sessions/index.js";
import type { OnCallInput, OnCallWorkerResult } from "../types.js";
import { createOpenHandsAdapter, type OpenHandsAdapter } from "../worker/adapter.js";

export type OnCallRouterResponse = {
  text: string;
  replyMode: "text" | "voice";
};

export type OnCallRouter = {
  processInbound: (input: OnCallInput) => Promise<OnCallRouterResponse>;
};

type OnCallRouterDeps = {
  projects?: OnCallProjectResolver;
  sessions?: OnCallSessionStore;
  memory?: OnCallMemoryStore;
  worker?: OpenHandsAdapter;
};

const defaultAdapter = createOpenHandsAdapter({
  baseUrl: process.env.ONCALLDEV_OPENHANDS_BASE_URL ?? "http://localhost:3001",
  apiKey: process.env.ONCALLDEV_OPENHANDS_API_KEY,
  openaiBaseUrl: process.env.ONCALLDEV_OPENAI_BASE_URL,
  model: process.env.ONCALLDEV_MODEL,
});

async function invokeWorker(
  action: string,
  worker: OpenHandsAdapter,
  projectId: string,
  text: string,
) {
  switch (action) {
    case "resume":
      return await worker.resume(projectId);
    case "status":
      return await worker.getStatus(projectId);
    case "summarize":
      return await worker.summarize(projectId);
    default:
      return await worker.runTask(projectId, text);
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
  const projects = deps.projects ?? createOnCallProjectResolver();
  const sessions = deps.sessions ?? createOnCallSessionStore();
  const memory = deps.memory ?? createOnCallMemoryStore();
  const worker = deps.worker ?? defaultAdapter;

  return {
    async processInbound(input) {
      const intent = resolveOnCallIntent(input);
      const project = projects.resolveByReference(intent.projectRef, input.userId);
      if (!project) {
        return {
          text: "I could not find a project mapping for this request.",
          replyMode: intent.replyMode,
        };
      }

      const session = sessions.getOrCreate({
        sessionKey: input.sessionKey,
        userId: input.userId,
        projectId: project.id,
      });
      assertOnCallProjectBoundary({ session, project });

      memory.appendEvent(session, {
        atMs: input.timestampMs,
        type: "user",
        text: intent.instruction,
      });

      const result = await invokeWorker(intent.action, worker, project.id, intent.instruction);

      memory.appendEvent(session, {
        atMs: Date.now(),
        type: "worker",
        text: result.text,
      });

      if (intent.action === "summarize") {
        memory.updateSummary(session, result.text);
      }

      return {
        text: buildReply(result),
        replyMode: intent.replyMode,
      };
    },
  };
}
