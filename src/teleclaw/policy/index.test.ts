import path from "node:path";
import { describe, expect, it } from "vitest";
import { canStartRuntime, validateRuntimeBootstrap, validateWorkspacePath } from "./index.js";

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
});
