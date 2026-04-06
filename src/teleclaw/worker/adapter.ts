import type { OnCallWorkerProgressEvent, OnCallWorkerResult } from "../types.js";
import type { OnCallExecutionProfile } from "../types.js";
import { resolveOpenHandsBridgeConfig } from "./openhands/config.js";
import { createOpenHandsBridge } from "./openhands/index.js";

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

function withBridge(config: ReturnType<typeof resolveOpenHandsBridgeConfig>): OpenHandsAdapter {
  const bridge = createOpenHandsBridge(config);

  return {
    async runTask(projectId, instruction, context) {
      const result = await bridge.run({ action: "task", projectId, instruction, context });
      await emitProgressEvents(context, result);
      return result;
    },
    async resume(projectId, context) {
      const result = await bridge.run({ action: "resume", projectId, context });
      await emitProgressEvents(context, result);
      return result;
    },
    async getStatus(projectId, context) {
      const result = await bridge.run({ action: "status", projectId, context });
      await emitProgressEvents(context, result);
      return result;
    },
    async summarize(projectId, context) {
      const result = await bridge.run({ action: "summarize", projectId, context });
      await emitProgressEvents(context, result);
      return result;
    },
  };
}

export function createOpenHandsAdapter(): OpenHandsAdapter {
  return withBridge(resolveOpenHandsBridgeConfig());
}
