import { existsSync } from "node:fs";
import path from "node:path";
import type { OpenHandsBridgeConfig, OpenHandsIntegrationMode } from "./types.js";

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function resolveMode(value: string | undefined): OpenHandsIntegrationMode {
  if (value === "remote_http" || value === "vendor_local" || value === "disabled") {
    return value;
  }
  return "vendor_local";
}

export function resolveOpenHandsBridgeConfig(env = process.env): OpenHandsBridgeConfig {
  const enabled = parseBoolean(env.OPENHANDS_ENABLED, true);
  const mode = enabled ? resolveMode(env.OPENHANDS_MODE) : "disabled";
  const explicitVendorPath = env.OPENHANDS_VENDOR_PATH;
  const defaultVendorPath = path.resolve("vendor/openhands");
  const containerVendorPath = "/app/vendor/openhands";
  const vendorPath = explicitVendorPath
    ? path.resolve(explicitVendorPath)
    : existsSync(defaultVendorPath)
      ? defaultVendorPath
      : containerVendorPath;

  return {
    enabled,
    mode,
    remoteFallbackEnabled: parseBoolean(env.OPENHANDS_REMOTE_FALLBACK_ENABLED, true),
    endpoint: env.OPENHANDS_ENDPOINT ?? "http://localhost:3001",
    apiKey: env.ONCALLDEV_OPENHANDS_API_KEY,
    llmBaseUrl: env.LLM_BASE_URL,
    llmApiKey: env.LLM_API_KEY,
    model: env.LLM_MODEL,
    vendorPath,
    pythonBin: env.OPENHANDS_PYTHON_BIN ?? "python3",
    logLevel: env.OPENHANDS_LOG_LEVEL,
  };
}
