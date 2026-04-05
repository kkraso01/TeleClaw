import path from "node:path";
import type { OnCallProjectRegistry } from "../projects/index.js";
import type { OnCallPolicyError, OnCallProject, OnCallRuntimeStatus } from "../types.js";

export type OnCallRuntimeState = {
  status: OnCallRuntimeStatus;
  containerId: string | null;
  containerName: string | null;
  runtimeFamily: string | null;
  workspacePath: string;
  checkedAt: string;
  error?: string;
};

export type OnCallRuntimeBindingResult = {
  outcome: "runtime_started" | "runtime_reused";
  status: OnCallRuntimeState;
};

export type OnCallRuntimeValidationResult =
  | {
      ok: true;
      status: OnCallRuntimeState;
    }
  | {
      ok: false;
      status: OnCallRuntimeState;
      reason: string;
      policy?: OnCallPolicyError;
    };

export type OnCallRuntimeProvider = {
  ensure: (project: OnCallProject) => Promise<OnCallRuntimeBindingResult>;
  getStatus: (project: OnCallProject) => Promise<OnCallRuntimeState>;
  start: (project: OnCallProject) => Promise<OnCallRuntimeState>;
  stop: (project: OnCallProject) => Promise<OnCallRuntimeState>;
  restart: (project: OnCallProject) => Promise<OnCallRuntimeState>;
  validate: (project: OnCallProject) => Promise<OnCallRuntimeValidationResult>;
};

export type OnCallRuntimeController = {
  ensureProjectRuntime: (project: OnCallProject) => Promise<OnCallRuntimeBindingResult>;
  getProjectRuntime: (project: OnCallProject) => Promise<OnCallRuntimeState>;
  startProjectRuntime: (project: OnCallProject) => Promise<OnCallRuntimeState>;
  stopProjectRuntime: (project: OnCallProject) => Promise<OnCallRuntimeState>;
  restartProjectRuntime: (project: OnCallProject) => Promise<OnCallRuntimeState>;
  validateProjectRuntime: (project: OnCallProject) => Promise<OnCallRuntimeValidationResult>;
};

type RuntimeControllerDeps = {
  projects: OnCallProjectRegistry;
  provider?: OnCallRuntimeProvider;
};

function nowIso() {
  return new Date().toISOString();
}

function inferRuntimeFamily(project: OnCallProject): string {
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

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-");
}

function buildContainerName(project: OnCallProject): string {
  return `teleclaw-${slugify(project.id)}`;
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

function createInMemoryRuntimeProvider(): OnCallRuntimeProvider {
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
      containerName: existing.containerName ?? buildContainerName(project),
      runtimeFamily,
      workspacePath: path.resolve(project.workspacePath),
      checkedAt: nowIso(),
    };
    state.set(project.id, started);
    return started;
  }

  return {
    async ensure(project) {
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

    async getStatus(project) {
      const current = getOrDefault(project);
      state.set(project.id, current);
      return current;
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

    async validate(project) {
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

function createDockerRuntimeProvider(): OnCallRuntimeProvider {
  const fallback = createInMemoryRuntimeProvider();
  return {
    async ensure(project) {
      // TODO(teleclaw): Replace seam fallback with real Docker lifecycle integration.
      return await fallback.ensure(project);
    },
    async getStatus(project) {
      return await fallback.getStatus(project);
    },
    async start(project) {
      return await fallback.start(project);
    },
    async stop(project) {
      return await fallback.stop(project);
    },
    async restart(project) {
      return await fallback.restart(project);
    },
    async validate(project) {
      return await fallback.validate(project);
    },
  };
}

export function createOnCallRuntimeProvider(): OnCallRuntimeProvider {
  const runtime = process.env.CONTAINER_RUNTIME ?? "local";
  const dockerEnabled = process.env.TELECLAW_DOCKER_ENABLED === "1";
  if (runtime === "docker" || dockerEnabled) {
    return createDockerRuntimeProvider();
  }
  return createInMemoryRuntimeProvider();
}

async function persistRuntimeState(
  projects: OnCallProjectRegistry,
  project: OnCallProject,
  status: OnCallRuntimeState,
): Promise<OnCallRuntimeState> {
  await projects.updateProjectRuntimeMetadata(project.id, {
    runtimeStatus: status.status,
    containerId: status.containerId,
    containerName: status.containerName,
    runtimeFamily: status.runtimeFamily,
    lastRuntimeCheckAt: status.checkedAt,
    lastRuntimeStartAt: status.status === "running" ? status.checkedAt : project.lastRuntimeStartAt,
    runtimeError: status.error ?? null,
  });
  return status;
}

export function createOnCallRuntimeController(
  deps: RuntimeControllerDeps,
): OnCallRuntimeController {
  const provider = deps.provider ?? createOnCallRuntimeProvider();

  return {
    async ensureProjectRuntime(project) {
      await deps.projects.updateProjectRuntimeMetadata(project.id, {
        runtimeStatus: "starting",
        lastRuntimeCheckAt: nowIso(),
      });

      const ensured = await provider.ensure(project);
      await persistRuntimeState(deps.projects, project, ensured.status);
      return ensured;
    },

    async getProjectRuntime(project) {
      const status = await provider.getStatus(project);
      await persistRuntimeState(deps.projects, project, status);
      return status;
    },

    async startProjectRuntime(project) {
      const status = await provider.start(project);
      await persistRuntimeState(deps.projects, project, status);
      return status;
    },

    async stopProjectRuntime(project) {
      const status = await provider.stop(project);
      await persistRuntimeState(deps.projects, project, status);
      return status;
    },

    async restartProjectRuntime(project) {
      const status = await provider.restart(project);
      await persistRuntimeState(deps.projects, project, status);
      return status;
    },

    async validateProjectRuntime(project) {
      const validation = await provider.validate(project);
      await persistRuntimeState(deps.projects, project, validation.status);
      if (!validation.ok) {
        await deps.projects.updateProjectRuntimeMetadata(project.id, {
          runtimeStatus: "error",
          runtimeError: validation.reason,
          lastRuntimeCheckAt: validation.status.checkedAt,
        });
      }
      return validation;
    },
  };
}
