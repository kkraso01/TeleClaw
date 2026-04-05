import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapProjectWorkspace,
  createOnCallProjectRegistry,
  detectRuntimeFamily,
} from "./index.js";

describe("createOnCallProjectRegistry", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates, reloads, and resolves project by alias", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-projects-"));
    const registry = createOnCallProjectRegistry({
      storePath: path.join(tmpDir, "projects.json"),
      projectsRoot: tmpDir,
      additionalAllowedRoots: [],
    });

    const created = await registry.createProject({
      id: "billing-api",
      name: "Billing API",
      aliases: ["billing"],
      language: "ts",
      workspacePath: path.join(tmpDir, "billing-api"),
      containerId: "container-1",
      runtimeFamily: "node",
      defaultReplyMode: "text",
      status: "active",
    });

    expect(created.aliases).toContain("billing");
    expect(created.bootstrapStatus).toBe("uninitialized");
    expect(created.executionProfile.testCommand.length).toBeGreaterThan(0);

    const reloaded = createOnCallProjectRegistry({
      storePath: path.join(tmpDir, "projects.json"),
      projectsRoot: tmpDir,
      additionalAllowedRoots: [],
    });

    const resolved = await reloaded.resolveProject({
      chatId: "chat-a",
      projectRef: "billing",
    });

    expect(resolved.type).toBe("resolved");
    if (resolved.type === "resolved") {
      expect(resolved.project.id).toBe("billing-api");
    }

    const saved = JSON.parse(await readFile(path.join(tmpDir, "projects.json"), "utf8")) as {
      projects: Array<{ id: string }>;
    };
    expect(saved.projects[0]?.id).toBe("billing-api");
  });

  it("updates runtime metadata durably", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-projects-"));
    const registry = createOnCallProjectRegistry({
      storePath: path.join(tmpDir, "projects.json"),
      projectsRoot: tmpDir,
      additionalAllowedRoots: [],
    });

    await registry.createProject({
      id: "frontend",
      name: "Frontend",
      aliases: ["frontend"],
      language: "ts",
      workspacePath: path.join(tmpDir, "frontend"),
      containerId: null,
      runtimeFamily: "node",
      defaultReplyMode: "text",
      status: "active",
    });

    const updated = await registry.updateProjectRuntimeMetadata("frontend", {
      runtimeStatus: "running",
      containerId: "ctr-frontend",
      containerName: "teleclaw-frontend",
      lastRuntimeStartAt: new Date().toISOString(),
      lastRuntimeCheckAt: new Date().toISOString(),
    });

    expect(updated?.runtimeStatus).toBe("running");
    expect(updated?.containerId).toBe("ctr-frontend");
  });

  it("bootstraps workspace directories", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-projects-"));
    vi.stubEnv("PROJECTS_ROOT", tmpDir);
    const workspacePath = path.join(tmpDir, "worker-api");
    const result = await bootstrapProjectWorkspace(
      {
        id: "worker-api",
        name: "Worker API",
        aliases: [],
        language: "ts",
        workspacePath,
        containerId: null,
        containerName: null,
        runtimeStatus: "unbound",
        runtimeFamily: null,
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
      },
      { createIfMissing: true },
    );
    expect(result.ok).toBe(true);
    expect(result.createdWorkspace).toBe(true);
  });

  it("bootstraps project metadata and repo state", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-projects-"));
    vi.stubEnv("PROJECTS_ROOT", tmpDir);
    const registry = createOnCallProjectRegistry({
      storePath: path.join(tmpDir, "projects.json"),
      projectsRoot: tmpDir,
      additionalAllowedRoots: [],
    });
    await registry.createProject({
      id: "scraper",
      name: "Scraper",
      aliases: ["scraper"],
      language: "py",
      workspacePath: path.join(tmpDir, "scraper"),
      containerId: null,
      runtimeFamily: "python",
      defaultReplyMode: "text",
      status: "active",
    });

    const bootstrapped = await registry.bootstrapProject("scraper", {
      createWorkspace: true,
      detectRuntimeFamily: true,
      initRepoIfMissing: false,
    });
    expect(bootstrapped?.bootstrapStatus).toBe("ready");
    expect(["missing", "error", "clean", "dirty"]).toContain(bootstrapped?.repoStatus);
  });

  it("detects runtime family from workspace hints", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-projects-"));
    vi.stubEnv("PROJECTS_ROOT", tmpDir);
    await writeFile(path.join(tmpDir, "pyproject.toml"), "[project]\nname='a'\n", "utf8");
    const runtimeFamily = await detectRuntimeFamily({
      id: "py-job",
      name: "Py Job",
      aliases: [],
      language: null,
      workspacePath: tmpDir,
      containerId: null,
      containerName: null,
      runtimeStatus: "unbound",
      runtimeFamily: null,
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
    });
    expect(runtimeFamily).toBe("python");
  });
});
