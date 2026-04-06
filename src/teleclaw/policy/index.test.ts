import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canStartRuntime,
  classifyApprovalNeed,
  validateProjectCreationInput,
  validateRepoUrl,
  validateRuntimeBootstrap,
  validateWorkspacePath,
} from "./index.js";

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: "billing",
    name: "Billing",
    aliases: [],
    language: "ts",
    workspacePath: path.resolve("/workspace/projects/billing"),
    containerId: null,
    containerName: null,
    runtimeStatus: "unbound",
    runtimeFamily: "node",
    defaultReplyMode: "text",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastRuntimeStartAt: null,
    lastRuntimeCheckAt: null,
    runtimeError: null,
    workspaceBootstrappedAt: null,
    workspaceBootstrapError: null,
    bootstrapStatus: "uninitialized",
    bootstrapError: null,
    repoUrl: null,
    repoStatus: "missing",
    branch: null,
    lastRepoSyncAt: null,
    repoError: null,
    executionProfile: {
      installCommand: "npm install",
      testCommand: "npm test",
      lintCommand: "npm run lint",
      buildCommand: "npm run build",
      runCommand: "npm run dev",
      packageManager: "npm",
      preferredShell: "bash",
    },
    ...overrides,
  } as never;
}

describe("teleclaw runtime policy", () => {
  it("blocks workspace paths outside allowed roots", () => {
    const result = validateWorkspacePath(project({ workspacePath: "/tmp/escape" }), {
      projectsRoot: "/workspace/projects",
      allowedProjectMounts: [],
    });
    expect(result?.code).toBe("workspace_disallowed");
  });

  it("blocks archived projects from bootstrap/start", () => {
    const bootstrapPolicy = validateRuntimeBootstrap(project({ status: "archived" }));
    const startPolicy = canStartRuntime(project({ status: "archived" }));
    expect(bootstrapPolicy?.code).toBe("project_archived");
    expect(startPolicy?.code).toBe("project_archived");
  });

  it("blocks mounts that are not allowlisted", () => {
    const result = validateWorkspacePath(project({ allowedMounts: ["/etc"] }), {
      projectsRoot: "/workspace/projects",
      allowedProjectMounts: ["/workspace/shared"],
    });
    expect(result?.code).toBe("mount_disallowed");
  });

  it("rejects unsafe workspace names", () => {
    const result = validateProjectCreationInput({
      name: "Billing",
      workspacePath: "/workspace/projects/../../etc/passwd",
    });
    expect(result?.code).toBe("workspace_name_invalid");
  });

  it("rejects invalid repo URL", () => {
    const result = validateRepoUrl("file:///tmp/local");
    expect(result?.code).toBe("repo_url_invalid");
  });

  it("classifies dangerous shell and delete actions for approval", () => {
    expect(classifyApprovalNeed("delete files under src")).toMatchObject({
      decision: "requires_approval",
      matchedRule: "delete_files",
    });
    expect(classifyApprovalNeed("git reset --hard HEAD~1")).toMatchObject({
      decision: "blocked",
      matchedRule: "force_reset",
    });
  });
});
