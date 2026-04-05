import type { OnCallWorkerResult } from "../types.js";

type OpenHandsAdapterConfig = {
  baseUrl: string;
  apiKey?: string;
  openaiBaseUrl?: string;
  model?: string;
};

export type OpenHandsAdapter = {
  runTask: (projectId: string, instruction: string) => Promise<OnCallWorkerResult>;
  resume: (projectId: string) => Promise<OnCallWorkerResult>;
  getStatus: (projectId: string) => Promise<OnCallWorkerResult>;
  summarize: (projectId: string) => Promise<OnCallWorkerResult>;
};

async function postAdapterRequest<T>(
  cfg: OpenHandsAdapterConfig,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(new URL(path, cfg.baseUrl), {
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

export function createOpenHandsAdapter(cfg: OpenHandsAdapterConfig): OpenHandsAdapter {
  const shared = {
    openaiBaseUrl: cfg.openaiBaseUrl,
    model: cfg.model,
  };

  return {
    async runTask(projectId, instruction) {
      return await postAdapterRequest<OnCallWorkerResult>(cfg, "/tasks/run", {
        projectId,
        instruction,
        ...shared,
      });
    },
    async resume(projectId) {
      return await postAdapterRequest<OnCallWorkerResult>(cfg, "/tasks/resume", {
        projectId,
        ...shared,
      });
    },
    async getStatus(projectId) {
      return await postAdapterRequest<OnCallWorkerResult>(cfg, "/tasks/status", {
        projectId,
      });
    },
    async summarize(projectId) {
      return await postAdapterRequest<OnCallWorkerResult>(cfg, "/tasks/summarize", {
        projectId,
      });
    },
  };
}
