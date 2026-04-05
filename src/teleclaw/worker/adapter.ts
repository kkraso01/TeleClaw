import type { OnCallAction, OnCallWorkerResult } from "../types.js";

export type OnCallWorkerContext = {
  sessionId?: string;
  workerSessionId?: string | null;
  workspacePath?: string;
  containerId?: string | null;
  summary?: string;
  structuredState?: Record<string, unknown>;
};

type OpenHandsAdapterConfig = {
  baseUrl: string;
  apiKey?: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
};

export type OpenHandsAdapter = {
  runTask: (
    projectId: string,
    instruction: string,
    context?: OnCallWorkerContext,
  ) => Promise<OnCallWorkerResult>;
  resume: (projectId: string, context?: OnCallWorkerContext) => Promise<OnCallWorkerResult>;
  getStatus: (projectId: string, context?: OnCallWorkerContext) => Promise<OnCallWorkerResult>;
  summarize: (projectId: string, context?: OnCallWorkerContext) => Promise<OnCallWorkerResult>;
};

type OpenHandsPayload = {
  projectId: string;
  action: OnCallAction;
  instruction?: string;
  sessionId?: string;
  workerSessionId?: string | null;
  workspacePath?: string;
  containerId?: string | null;
  summary?: string;
  structuredState?: Record<string, unknown>;
  llmBaseUrl?: string;
  llmApiKey?: string;
  model?: string;
};

async function postAdapterRequest<T>(
  cfg: OpenHandsAdapterConfig,
  path: string,
  body: OpenHandsPayload,
): Promise<T> {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const response = await fetchImpl(new URL(path, cfg.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`openhands request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

function buildPayload(
  cfg: OpenHandsAdapterConfig,
  action: OnCallAction,
  projectId: string,
  context: OnCallWorkerContext | undefined,
  instruction?: string,
): OpenHandsPayload {
  return {
    action,
    projectId,
    instruction,
    sessionId: context?.sessionId,
    workerSessionId: context?.workerSessionId,
    workspacePath: context?.workspacePath,
    containerId: context?.containerId,
    summary: context?.summary,
    structuredState: context?.structuredState,
    llmBaseUrl: cfg.llmBaseUrl,
    llmApiKey: cfg.llmApiKey,
    model: cfg.model,
  };
}

export function createOpenHandsAdapter(cfg: OpenHandsAdapterConfig): OpenHandsAdapter {
  return {
    async runTask(projectId, instruction, context) {
      return await postAdapterRequest<OnCallWorkerResult>(
        cfg,
        "/tasks/run",
        buildPayload(cfg, "task", projectId, context, instruction),
      );
    },
    async resume(projectId, context) {
      return await postAdapterRequest<OnCallWorkerResult>(
        cfg,
        "/tasks/resume",
        buildPayload(cfg, "resume", projectId, context),
      );
    },
    async getStatus(projectId, context) {
      return await postAdapterRequest<OnCallWorkerResult>(
        cfg,
        "/tasks/status",
        buildPayload(cfg, "status", projectId, context),
      );
    },
    async summarize(projectId, context) {
      return await postAdapterRequest<OnCallWorkerResult>(
        cfg,
        "/tasks/summarize",
        buildPayload(cfg, "summarize", projectId, context),
      );
    },
  };
}
