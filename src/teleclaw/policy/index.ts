import path from "node:path";
import type { OnCallRuntimeState } from "../runtime/index.js";
import type { OnCallApprovalClassification, OnCallPolicyError, OnCallProject } from "../types.js";

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

const safeWorkspaceNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,80}$/;

export function validateProjectCreationInput(params: {
  name: string;
  workspacePath: string;
}): OnCallPolicyError | null {
  if (!params.name.trim()) {
    return makeError("project_name_invalid", "Project name cannot be empty.");
  }
  const rawSegments = params.workspacePath.split(/[\\/]+/).filter(Boolean);
  if (rawSegments.includes("..")) {
    return makeError("workspace_name_invalid", "Workspace path cannot include parent traversal.", {
      workspacePath: params.workspacePath,
    });
  }
  const workspaceName = path.basename(path.resolve(params.workspacePath));
  if (!safeWorkspaceNamePattern.test(workspaceName)) {
    return makeError(
      "workspace_name_invalid",
      "Workspace folder name contains unsafe characters.",
      { workspaceName },
    );
  }
  return null;
}

export function validateRepoUrl(repoUrl: string): OnCallPolicyError | null {
  const trimmed = repoUrl.trim();
  const httpUrl = /^https?:\/\/[a-zA-Z0-9._:@/-]+(\.git)?$/i;
  const sshUrl = /^git@[a-zA-Z0-9._-]+:[a-zA-Z0-9._/-]+(\.git)?$/i;
  if (!httpUrl.test(trimmed) && !sshUrl.test(trimmed)) {
    return makeError("repo_url_invalid", "Repository URL format is invalid.", {
      repoUrl: trimmed,
    });
  }
  return null;
}

export function canBootstrapProject(project: OnCallProject): OnCallPolicyError | null {
  const executionPolicy = canExecuteProject(project);
  if (executionPolicy) {
    return executionPolicy;
  }
  return validateWorkspacePath(project);
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

const dangerousActionRules: Array<{
  pattern: RegExp;
  classification: OnCallApprovalClassification;
}> = [
  {
    pattern:
      /\brm\s+-rf\b|\brmdir\b|\bdel\s+\/[sq]\b|\bunlink\b|\bdelete\s+(file|files|folder|folders|directory|directories)\b/i,
    classification: {
      decision: "requires_approval",
      reason: "Potential file or directory deletion detected.",
      matchedRule: "delete_files",
      riskLevel: "high",
      requiresExplicitApproval: true,
    },
  },
  {
    pattern: /\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-fdx\b|\bgit\s+checkout\s+--\s+\./i,
    classification: {
      decision: "blocked",
      reason: "Potentially destructive repository reset detected.",
      matchedRule: "force_reset",
      riskLevel: "high",
      requiresExplicitApproval: true,
    },
  },
  {
    pattern: /\bgit\s+branch\s+-D\b|\bgit\s+push\s+--force\b/i,
    classification: {
      decision: "requires_approval",
      reason: "Destructive branch operation detected.",
      matchedRule: "destructive_branch",
      riskLevel: "high",
      requiresExplicitApproval: true,
    },
  },
  {
    pattern: /\bnpm\s+remove\b|\bpnpm\s+remove\b|\byarn\s+remove\b|\buninstall\b/i,
    classification: {
      decision: "requires_approval",
      reason: "Dependency removal or major dependency mutation detected.",
      matchedRule: "dependency_removal",
      riskLevel: "medium",
      requiresExplicitApproval: true,
    },
  },
  {
    pattern: /\b(clean|cleanup)\b.*\b(all|workspace|repo|repository)\b/i,
    classification: {
      decision: "requires_approval",
      reason: "Broad cleanup request detected.",
      matchedRule: "mass_cleanup",
      riskLevel: "medium",
      requiresExplicitApproval: true,
    },
  },
  {
    pattern: /\bcurl\s+.*\|\s*(sh|bash)\b|\bwget\s+.*\|\s*(sh|bash)\b|\bdd\s+if=\/dev\//i,
    classification: {
      decision: "blocked",
      reason: "Dangerous shell operation detected.",
      matchedRule: "dangerous_shell",
      riskLevel: "high",
      requiresExplicitApproval: true,
    },
  },
];

export function classifyApprovalNeed(instruction: string): OnCallApprovalClassification {
  for (const rule of dangerousActionRules) {
    if (rule.pattern.test(instruction)) {
      return rule.classification;
    }
  }
  return {
    decision: "allowed",
    reason: "No risky operation pattern detected.",
    matchedRule: "none",
    riskLevel: "low",
    requiresExplicitApproval: false,
  };
}
