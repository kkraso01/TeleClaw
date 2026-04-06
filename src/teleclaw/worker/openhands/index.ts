import { spawn } from "node:child_process";
import path from "node:path";
import { toOpenHandsInstruction } from "./mapper.js";
import type {
  OpenHandsBridgeConfig,
  OpenHandsBridgeRequest,
  OpenHandsBridgeResponse,
} from "./types.js";

function inferProgressFromOutput(output: string): OpenHandsBridgeResponse["progressEvents"] {
  const now = Date.now();
  const events: NonNullable<OpenHandsBridgeResponse["progressEvents"]> = [];
  if (/plan|planning/i.test(output)) {
    events.push({
      atMs: now,
      kind: "planning_started",
      message: "Planning phase observed in OpenHands output.",
      phase: "planning",
    });
  }
  if (/implement|coding|writing code/i.test(output)) {
    events.push({
      atMs: now,
      kind: "implementation_started",
      message: "Implementation phase observed in OpenHands output.",
      phase: "implementing",
    });
  }
  if (/install|dependency/i.test(output)) {
    events.push({
      atMs: now,
      kind: "dependency_install",
      message: "Dependency install observed in OpenHands output.",
    });
    if (/installed|complete|finished/i.test(output)) {
      events.push({
        atMs: now,
        kind: "dependency_install_finished",
        message: "Dependency install completion observed in OpenHands output.",
      });
    }
  }
  if (/test/i.test(output)) {
    events.push({
      atMs: now,
      kind: "testing_started",
      message: "Test activity observed in OpenHands output.",
      phase: "testing",
    });
    if (/all tests passed|tests passed|passing/i.test(output)) {
      events.push({
        atMs: now,
        kind: "tests_passed",
        message: "Test pass signal observed in OpenHands output.",
        phase: "testing",
      });
    }
    if (/tests failed|failing test|failed:/i.test(output)) {
      events.push({
        atMs: now,
        kind: "tests_failed",
        message: "Test failure signal observed in OpenHands output.",
        phase: "blocked",
      });
    }
  }
  if (/build/i.test(output)) {
    events.push({
      atMs: now,
      kind: "build_started",
      message: "Build activity observed in OpenHands output.",
      phase: "implementing",
    });
    if (/build (?:succeeded|passed|complete)/i.test(output)) {
      events.push({
        atMs: now,
        kind: "build_finished",
        message: "Build completion observed in OpenHands output.",
        phase: "reporting",
      });
    }
  }
  if (/error|exception|traceback/i.test(output)) {
    events.push({
      atMs: now,
      kind: "worker_error",
      message: "OpenHands emitted an error in output.",
      phase: "blocked",
    });
  }
  return events;
}

async function runRemoteHttp(
  cfg: OpenHandsBridgeConfig,
  request: OpenHandsBridgeRequest,
): Promise<OpenHandsBridgeResponse> {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const response = await fetchImpl(
    new URL(`/tasks/${request.action === "task" ? "run" : request.action}`, cfg.endpoint),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        ...request,
        llmBaseUrl: cfg.llmBaseUrl,
        llmApiKey: cfg.llmApiKey,
        model: cfg.model,
      }),
    },
  );

  if (!response.ok) {
    return {
      status: "error",
      text: `OpenHands HTTP bridge failed: ${response.status} ${response.statusText}`,
    };
  }

  return (await response.json()) as OpenHandsBridgeResponse;
}

async function runVendoredLocal(
  cfg: OpenHandsBridgeConfig,
  request: OpenHandsBridgeRequest,
): Promise<OpenHandsBridgeResponse> {
  const instruction = toOpenHandsInstruction(request.action, request.instruction, request.context);
  const sessionName =
    request.context?.workerSessionId ??
    request.context?.sessionId ??
    `teleclaw-${request.projectId}`;
  const workspacePath = request.context?.workspacePath;

  if (!workspacePath) {
    return {
      status: "error",
      text: "OpenHands vendored mode requires a workspacePath in worker context.",
    };
  }

  const env = {
    ...process.env,
    PYTHONPATH: [cfg.vendorPath, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    ...(cfg.model ? { LLM_MODEL: cfg.model } : {}),
    ...(cfg.llmBaseUrl ? { LLM_BASE_URL: cfg.llmBaseUrl } : {}),
    ...(cfg.llmApiKey ? { LLM_API_KEY: cfg.llmApiKey } : {}),
    ...(cfg.logLevel ? { LOG_LEVEL: cfg.logLevel } : {}),
  };

  const args = [
    "-m",
    "openhands.core.main",
    "-t",
    instruction,
    "-n",
    sessionName,
    "-d",
    workspacePath,
  ];

  return await new Promise<OpenHandsBridgeResponse>((resolve) => {
    const child = spawn(cfg.pythonBin, args, { cwd: cfg.vendorPath, env });
    const stdout: string[] = [];
    const stderr: string[] = [];

    child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    child.on("error", (error) => {
      resolve({
        status: "error",
        text: `OpenHands vendored execution failed to start: ${error.message}`,
      });
    });
    child.on("close", (code) => {
      const out = stdout.join("").trim();
      const err = stderr.join("").trim();
      const combined = [out, err].filter(Boolean).join("\n");
      if (code !== 0) {
        resolve({
          status: "error",
          text: combined || `OpenHands exited with status ${code ?? -1}.`,
          progressEvents: inferProgressFromOutput(combined),
          meta: { mode: "vendor_local", exitCode: code ?? -1 },
        });
        return;
      }
      resolve({
        status: "ok",
        text: out || "OpenHands completed task.",
        summary: out || undefined,
        phase: "reporting",
        blockerReason: undefined,
        nextSuggestedStep: "Review changes and run any remaining validation.",
        workerSessionId: sessionName,
        filesChanged: [],
        progressEvents: inferProgressFromOutput(combined),
        meta: { mode: "vendor_local", exitCode: 0 },
      });
    });
  });
}

export function createOpenHandsBridge(cfg: OpenHandsBridgeConfig) {
  return {
    async run(request: OpenHandsBridgeRequest): Promise<OpenHandsBridgeResponse> {
      if (!cfg.enabled || cfg.mode === "disabled") {
        return {
          status: "error",
          text: "OpenHands worker integration is disabled.",
          meta: { mode: "disabled" },
        };
      }
      if (cfg.mode === "remote_http") {
        return await runRemoteHttp(cfg, request);
      }
      const vendoredResult = await runVendoredLocal(cfg, request);
      if (
        vendoredResult.status === "error" &&
        cfg.remoteFallbackEnabled &&
        cfg.endpoint &&
        !vendoredResult.meta?.fallbackAttempted
      ) {
        const remoteResult = await runRemoteHttp(cfg, request);
        return {
          ...remoteResult,
          meta: {
            ...remoteResult.meta,
            mode: "remote_http_fallback",
            fallbackFrom: "vendor_local",
            vendoredError: vendoredResult.text,
          },
        };
      }
      return vendoredResult;
    },
  };
}
