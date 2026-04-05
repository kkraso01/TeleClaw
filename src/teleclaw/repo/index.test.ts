import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRepoModule } from "./index.js";

function project(workspacePath: string) {
  const now = new Date().toISOString();
  return {
    id: "repo-test",
    name: "Repo Test",
    aliases: [],
    language: "ts",
    workspacePath,
    containerId: null,
    containerName: null,
    runtimeStatus: "unbound",
    runtimeFamily: "node",
    defaultReplyMode: "text",
    status: "active",
    createdAt: now,
    updatedAt: now,
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
  } as never;
}

describe("teleclaw repo module", () => {
  it("returns missing for non-git workspace", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-repo-"));
    await writeFile(path.join(tmpDir, "README.md"), "hello", "utf8");
    const module = createRepoModule();
    const status = await module.getRepoStatus(project(tmpDir));
    expect(["missing", "error"]).toContain(status.repoStatus);
  });
});
