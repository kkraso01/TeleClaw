import type { OnCallAction, OnCallWorkerProgressEvent, OnCallWorkerResult } from "../../types.js";
import type { OnCallWorkerContext } from "../adapter.js";

export type OpenHandsIntegrationMode = "vendor_local" | "remote_http" | "disabled";

export type OpenHandsBridgeConfig = {
  enabled: boolean;
  mode: OpenHandsIntegrationMode;
  endpoint: string;
  apiKey?: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
  model?: string;
  vendorPath: string;
  pythonBin: string;
  logLevel?: string;
  fetchImpl?: typeof fetch;
};

export type OpenHandsBridgeRequest = {
  projectId: string;
  action: OnCallAction;
  instruction?: string;
  context?: OnCallWorkerContext;
};

export type OpenHandsBridgeResponse = OnCallWorkerResult & {
  progressEvents?: OnCallWorkerProgressEvent[];
};
