import path from "node:path";
import type { OnCallRuntimeState } from "../runtime/index.js";
import type { OnCallPolicyError, OnCallProject } from "../types.js";

type OnCallPolicyConfig = {
  projectsRoot: string;
  allowedProjectMounts: string[];
  allowedRuntimeFamilies: string[];
};

function parseListFromEnv(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolvePolicyConfig(config: Partial<OnCallPolicyConfig> = {}): OnCallPolicyConfig {
  return {
    projectsRoot: path.resolve(
      process.env.PROJECTS_ROOT ?? path.resolve(process.cwd(), "workspace"),
    ),
    allowedProjectMounts: parseListFromEnv(process.env.ALLOWED_PROJECT_MOUNTS).map((entry) =>
      path.resolve(entry),
    ),
    allowedRuntimeFamilies: parseListFromEnv(process.env.TELECLAW_ALLOWED_RUNTIME_FAMILIES),
    ...config,
  };
}

function isWithinRoot(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function makeError(
  code: OnCallPolicyError["code"],
  message: string,
  details?: Record<string, unknown>,
): OnCallPolicyError {
  return { code, message, details };
}

function validateProjectMountAllowlist(
  project: OnCallProject,
  config: OnCallPolicyConfig,
): OnCallPolicyError | null {
  if (!project.allowedMounts?.length) {
    return null;
  }

  for (const mount of project.allowedMounts) {
    const resolvedMount = path.resolve(mount);
    const mountAllowed = [config.projectsRoot, ...config.allowedProjectMounts].some((allowedRoot) =>
      isWithinRoot(resolvedMount, allowedRoot),
    );
    if (!mountAllowed) {
      return makeError("mount_disallowed", "Project mount is not in allowed project mounts.", {
        mount,
        resolvedMount,
      });
    }
  }

  return null;
}

export function validateWorkspacePath(
  project: OnCallProject,
  config: Partial<OnCallPolicyConfig> = {},
): OnCallPolicyError | null {
  const resolvedConfig = resolvePolicyConfig(config);
  const workspacePath = path.resolve(project.workspacePath);
  const allowedRoots = [resolvedConfig.projectsRoot, ...resolvedConfig.allowedProjectMounts];
  if (!allowedRoots.some((root) => isWithinRoot(workspacePath, root))) {
    return makeError("workspace_disallowed", "Project workspace path is outside allowed roots.", {
      workspacePath,
      allowedRoots,
    });
  }

  return validateProjectMountAllowlist(project, resolvedConfig);
}

export function canExecuteProject(project: OnCallProject): OnCallPolicyError | null {
  if (project.status === "archived") {
    return makeError("project_archived", "Project is archived and cannot execute new work.", {
      projectId: project.id,
    });
  }
  if (project.status === "paused") {
    return makeError("project_paused", "Project is paused and cannot execute until resumed.", {
      projectId: project.id,
    });
  }
  return null;
}

export function canBindProject(
  _session: { activeProjectId: string | null },
  project: OnCallProject,
): OnCallPolicyError | null {
  return canExecuteProject(project);
}

export function validateRuntimeBootstrap(
  project: OnCallProject,
  config: Partial<OnCallPolicyConfig> = {},
): OnCallPolicyError | null {
  const executionPolicy = canExecuteProject(project);
  if (executionPolicy) {
    return executionPolicy;
  }

  const workspacePolicy = validateWorkspacePath(project, config);
  if (workspacePolicy) {
    return workspacePolicy;
  }

  return null;
}

export function canStartRuntime(
  project: OnCallProject,
  config: Partial<OnCallPolicyConfig> = {},
): OnCallPolicyError | null {
  const bootstrapPolicy = validateRuntimeBootstrap(project, config);
  if (bootstrapPolicy) {
    return bootstrapPolicy;
  }

  const resolved = resolvePolicyConfig(config);
  if (
    resolved.allowedRuntimeFamilies.length > 0 &&
    project.runtimeFamily &&
    !resolved.allowedRuntimeFamilies.includes(project.runtimeFamily)
  ) {
    return makeError(
      "runtime_family_disallowed",
      `Runtime family is not allowed: ${project.runtimeFamily}`,
      {
        projectId: project.id,
        allowedRuntimeFamilies: resolved.allowedRuntimeFamilies,
      },
    );
  }

  return null;
}

export function canAttachRuntime(
  project: OnCallProject,
  runtimeState: OnCallRuntimeState,
  config: Partial<OnCallPolicyConfig> = {},
): OnCallPolicyError | null {
  const startPolicy = canStartRuntime(project, config);
  if (startPolicy) {
    return startPolicy;
  }

  if (runtimeState.status !== "running" || !runtimeState.containerId) {
    return makeError("runtime_attach_failed", "Runtime is not currently attachable.", {
      projectId: project.id,
      status: runtimeState.status,
      containerId: runtimeState.containerId,
    });
  }

  return null;
}

export function requireExecutionContext(project: OnCallProject | null): OnCallPolicyError | null {
  if (!project) {
    return makeError("project_required", "Execution requires a resolved project context.");
  }
  return canStartRuntime(project);
}

export function explainRuntimePolicyFailure(policy: OnCallPolicyError): string {
  return `Runtime policy blocked this request: ${policy.message} [${policy.code}]`;
}

export function explainPolicyFailure(policy: OnCallPolicyError): string {
  return `${policy.message} [${policy.code}]`;
}
