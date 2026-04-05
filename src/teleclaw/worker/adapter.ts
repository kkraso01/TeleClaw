import type { OnCallAction, OnCallWorkerProgressEvent, OnCallWorkerResult } from "../types.js";
import type { OnCallExecutionProfile } from "../types.js";

export type OnCallWorkerContext = {
  projectId?: string;
  sessionId?: string;
  workerSessionId?: string | null;
  workspacePath?: string;
  containerId?: string | null;
  containerName?: string | null;
  runtimeFamily?: string | null;
  executionProfile?: OnCallExecutionProfile;
  repoMetadata?: {
    repoUrl: string | null;
    repoStatus: string;
    branch: string | null;
  };
  bootstrapState?: {
    bootstrapStatus: string;
    bootstrapError: string | null;
  };
  summary?: string;
  structuredState?: Record<string, unknown>;
  onProgress?: (event: OnCallWorkerProgressEvent) => Promise<void> | void;
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
  containerName?: string | null;
  runtimeFamily?: string | null;
  executionProfile?: OnCallExecutionProfile;
  repoMetadata?: Record<string, unknown>;
  bootstrapState?: Record<string, unknown>;
  summary?: string;
  structuredState?: Record<string, unknown>;
  llmBaseUrl?: string;
  llmApiKey?: string;
  model?: string;
};

async function postAdapterRequest<T>(
  cfg: OpenHandsAdapterConfig,
  requestPath: string,
  body: OpenHandsPayload,
): Promise<T> {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const response = await fetchImpl(new URL(requestPath, cfg.baseUrl), {
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
    containerName: context?.containerName,
    runtimeFamily: context?.runtimeFamily,
    executionProfile: context?.executionProfile,
    repoMetadata: context?.repoMetadata,
    bootstrapState: context?.bootstrapState,
    summary: context?.summary,
    structuredState: context?.structuredState,
    llmBaseUrl: cfg.llmBaseUrl,
    llmApiKey: cfg.llmApiKey,
    model: cfg.model,
  };
}

async function emitProgressEvents(
  context: OnCallWorkerContext | undefined,
  result: OnCallWorkerResult,
): Promise<void> {
  if (!context?.onProgress || !Array.isArray(result.progressEvents)) {
    return;
  }
  for (const event of result.progressEvents) {
    await context.onProgress(event);
  }
}

export function createOpenHandsAdapter(cfg: OpenHandsAdapterConfig): OpenHandsAdapter {
  return {
    async runTask(projectId, instruction, context) {
      const result = await postAdapterRequest<OnCallWorkerResult>(
        cfg,
        "/tasks/run",
        buildPayload(cfg, "task", projectId, context, instruction),
      );
      await emitProgressEvents(context, result);
      return result;
    },
    async resume(projectId, context) {
      const result = await postAdapterRequest<OnCallWorkerResult>(
        cfg,
        "/tasks/resume",
        buildPayload(cfg, "resume", projectId, context),
      );
      await emitProgressEvents(context, result);
      return result;
    },
    async getStatus(projectId, context) {
      const result = await postAdapterRequest<OnCallWorkerResult>(
        cfg,
        "/tasks/status",
        buildPayload(cfg, "status", projectId, context),
      );
      await emitProgressEvents(context, result);
      return result;
    },
    async summarize(projectId, context) {
      const result = await postAdapterRequest<OnCallWorkerResult>(
        cfg,
        "/tasks/summarize",
        buildPayload(cfg, "summarize", projectId, context),
      );
      await emitProgressEvents(context, result);
      return result;
    },
  };
}
