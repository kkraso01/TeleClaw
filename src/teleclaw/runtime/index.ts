import type { OnCallProjectRegistry } from "../projects/index.js";
import {
  bootstrapProjectWorkspace,
  detectRuntimeFamily,
  ensureWorkspace,
  validateProjectWorkspacePolicy,
} from "../projects/index.js";
import type { OnCallPolicyError, OnCallProject, OnCallRuntimeStatus } from "../types.js";
import { createDockerRuntimeProvider } from "./providers/docker.js";
import { createInMemoryRuntimeProvider, inferRuntimeFamily } from "./providers/local.js";

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
  inspect: (project: OnCallProject) => Promise<OnCallRuntimeState>;
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
  reconcileProjectRuntime: (project: OnCallProject) => Promise<OnCallRuntimeState>;
  reconcileAllProjectRuntimes: () => Promise<OnCallRuntimeState[]>;
};

type RuntimeControllerDeps = {
  projects: OnCallProjectRegistry;
  provider?: OnCallRuntimeProvider;
};

function nowIso() {
  return new Date().toISOString();
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

async function bootstrapWorkspaceIfEnabled(
  projects: OnCallProjectRegistry,
  project: OnCallProject,
): Promise<OnCallProject> {
  const bootstrapEnabled = process.env.TELECLAW_RUNTIME_BOOTSTRAP_ENABLED !== "0";
  if (!bootstrapEnabled) {
    return project;
  }

  const workspacePolicy = validateProjectWorkspacePolicy(project);
  if (workspacePolicy) {
    await projects.updateProjectRuntimeMetadata(project.id, {
      runtimeStatus: "error",
      runtimeError: workspacePolicy.message,
      lastRuntimeCheckAt: nowIso(),
    });
    return project;
  }

  await ensureWorkspace(project, { createIfMissing: true });
  const detectedFamily = await detectRuntimeFamily(project);
  const bootstrap = await bootstrapProjectWorkspace(project, {
    createIfMissing: true,
    runtimeFamily: detectedFamily ?? inferRuntimeFamily(project),
  });
  await projects.updateProjectRuntimeMetadata(project.id, {
    runtimeFamily: bootstrap.runtimeFamily,
    workspaceBootstrappedAt: bootstrap.ok ? bootstrap.checkedAt : project.workspaceBootstrappedAt,
    workspaceBootstrapError: bootstrap.ok
      ? null
      : (bootstrap.error ?? "workspace bootstrap failed"),
    runtimeError: bootstrap.ok ? null : (bootstrap.error ?? "workspace bootstrap failed"),
    runtimeStatus: bootstrap.ok ? project.runtimeStatus : "error",
    lastRuntimeCheckAt: bootstrap.checkedAt,
  });
  if (!bootstrap.ok) {
    return project;
  }

  const refreshed = await projects.getProjectById(project.id);
  return refreshed ?? project;
}

function shouldMarkAsStale(status: OnCallRuntimeState): boolean {
  return (
    status.error === "container_not_found" || (status.status === "error" && !status.containerId)
  );
}

export function createOnCallRuntimeController(
  deps: RuntimeControllerDeps,
): OnCallRuntimeController {
  const provider = deps.provider ?? createOnCallRuntimeProvider();

  return {
    async ensureProjectRuntime(project) {
      const bootstrappedProject = await bootstrapWorkspaceIfEnabled(deps.projects, project);

      await deps.projects.updateProjectRuntimeMetadata(bootstrappedProject.id, {
        runtimeStatus: "starting",
        lastRuntimeCheckAt: nowIso(),
      });

      const ensured = await provider.ensure(bootstrappedProject);
      await persistRuntimeState(deps.projects, bootstrappedProject, ensured.status);
      return ensured;
    },

    async getProjectRuntime(project) {
      const status = await provider.getStatus(project);
      await persistRuntimeState(deps.projects, project, status);
      return status;
    },

    async startProjectRuntime(project) {
      const bootstrappedProject = await bootstrapWorkspaceIfEnabled(deps.projects, project);
      const status = await provider.start(bootstrappedProject);
      await persistRuntimeState(deps.projects, bootstrappedProject, status);
      return status;
    },

    async stopProjectRuntime(project) {
      const status = await provider.stop(project);
      await persistRuntimeState(deps.projects, project, status);
      return status;
    },

    async restartProjectRuntime(project) {
      const bootstrappedProject = await bootstrapWorkspaceIfEnabled(deps.projects, project);
      const status = await provider.restart(bootstrappedProject);
      await persistRuntimeState(deps.projects, bootstrappedProject, status);
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

    async reconcileProjectRuntime(project) {
      const status = await provider.inspect(project);
      if (shouldMarkAsStale(status)) {
        const stale: OnCallRuntimeState = {
          ...status,
          status: "unbound",
          containerId: null,
          containerName: null,
          error: status.error ?? "runtime_stale",
          checkedAt: nowIso(),
        };
        await persistRuntimeState(deps.projects, project, stale);
        return stale;
      }
      await persistRuntimeState(deps.projects, project, status);
      return status;
    },

    async reconcileAllProjectRuntimes() {
      const projects = await deps.projects.listProjects();
      const reconciled: OnCallRuntimeState[] = [];
      for (const project of projects) {
        reconciled.push(await this.reconcileProjectRuntime(project));
      }
      return reconciled;
    },
  };
}

export {
  buildDeterministicContainerName,
  inferRuntimeFamily,
  selectImage,
} from "./providers/docker.js";
