import path from "node:path";
import type { OnCallProject } from "../../types.js";
import type {
  OnCallRuntimeBindingResult,
  OnCallRuntimeProvider,
  OnCallRuntimeState,
  OnCallRuntimeValidationResult,
} from "../index.js";

function nowIso() {
  return new Date().toISOString();
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function inferRuntimeFamily(project: OnCallProject): string {
  if (project.runtimeFamily) {
    return project.runtimeFamily;
  }
  if (project.language === "ts" || project.language === "js") {
    return "node";
  }
  if (project.language === "py") {
    return "python";
  }
  return "generic";
}

export function buildDeterministicContainerName(projectId: string): string {
  const slug = slugify(projectId) || "project";
  return `teleclaw-${slug}`;
}

function toRuntimeState(project: OnCallProject): OnCallRuntimeState {
  return {
    status: project.runtimeStatus,
    containerId: project.containerId,
    containerName: project.containerName,
    runtimeFamily: project.runtimeFamily,
    workspacePath: path.resolve(project.workspacePath),
    checkedAt: nowIso(),
    error: project.runtimeError ?? undefined,
  };
}

export function createInMemoryRuntimeProvider(): OnCallRuntimeProvider {
  const state = new Map<string, OnCallRuntimeState>();

  function getOrDefault(project: OnCallProject): OnCallRuntimeState {
    const current = state.get(project.id);
    if (current) {
      return { ...current, checkedAt: nowIso() };
    }
    return toRuntimeState(project);
  }

  function ensureRunningRuntime(project: OnCallProject): OnCallRuntimeState {
    const existing = getOrDefault(project);
    if (existing.status === "running" && existing.containerId) {
      return existing;
    }
    const runtimeFamily = inferRuntimeFamily(project);
    const started: OnCallRuntimeState = {
      status: "running",
      containerId: existing.containerId ?? `ctr-${slugify(project.id)}`,
      containerName: existing.containerName ?? buildDeterministicContainerName(project.id),
      runtimeFamily,
      workspacePath: path.resolve(project.workspacePath),
      checkedAt: nowIso(),
    };
    state.set(project.id, started);
    return started;
  }

  return {
    async ensure(project): Promise<OnCallRuntimeBindingResult> {
      const current = getOrDefault(project);
      if (current.status === "running" && current.containerId) {
        state.set(project.id, current);
        return {
          outcome: "runtime_reused",
          status: current,
        };
      }
      const started = ensureRunningRuntime(project);
      return {
        outcome: "runtime_started",
        status: started,
      };
    },

    async inspect(project) {
      const current = getOrDefault(project);
      state.set(project.id, current);
      return current;
    },

    async getStatus(project) {
      return await this.inspect(project);
    },

    async start(project) {
      return ensureRunningRuntime(project);
    },

    async stop(project) {
      const current = getOrDefault(project);
      const stopped: OnCallRuntimeState = {
        ...current,
        status: "stopped",
        checkedAt: nowIso(),
      };
      state.set(project.id, stopped);
      return stopped;
    },

    async restart(project) {
      const started = ensureRunningRuntime(project);
      return {
        ...started,
        checkedAt: nowIso(),
      };
    },

    async validate(project): Promise<OnCallRuntimeValidationResult> {
      const current = getOrDefault(project);
      if (current.status === "running" && current.containerId) {
        return { ok: true, status: current };
      }
      return {
        ok: false,
        status: current,
        reason: "runtime_not_running",
      };
    },
  };
}
