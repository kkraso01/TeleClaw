import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOnCallProjectRegistry } from "../projects/index.js";
import {
  buildDeterministicContainerName,
  createOnCallRuntimeController,
  inferRuntimeFamily,
  selectImage,
} from "./index.js";

async function makeRegistry() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-runtime-"));
  vi.stubEnv("PROJECTS_ROOT", tmpDir);
  vi.stubEnv("TELECLAW_RUNTIME_BOOTSTRAP_ENABLED", "1");
  const projects = createOnCallProjectRegistry({
    storePath: path.join(tmpDir, "projects.json"),
    projectsRoot: tmpDir,
    additionalAllowedRoots: [],
  });

  const project = await projects.createProject({
    id: "billing",
    name: "Billing",
    aliases: ["billing"],
    language: "ts",
    workspacePath: path.join(tmpDir, "billing"),
    containerId: null,
    runtimeFamily: "node",
    defaultReplyMode: "text",
    status: "active",
  });

  return { projects, project, tmpDir };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createOnCallRuntimeController", () => {
  it("creates runtime binding when missing", async () => {
    const { projects, project } = await makeRegistry();
    const runtime = createOnCallRuntimeController({ projects });

    const result = await runtime.ensureProjectRuntime(project);

    expect(result.outcome).toBe("runtime_started");
    expect(result.status.containerId).toContain("ctr-billing");

    const persisted = await projects.getProjectById("billing");
    expect(persisted?.runtimeStatus).toBe("running");
    expect(persisted?.containerId).toBeTruthy();
    expect(persisted?.workspaceBootstrappedAt).toBeTruthy();
  });

  it("reuses running runtime binding", async () => {
    const { projects, project } = await makeRegistry();
    const runtime = createOnCallRuntimeController({ projects });

    await runtime.ensureProjectRuntime(project);
    const reloaded = await projects.getProjectById("billing");
    const second = await runtime.ensureProjectRuntime(reloaded as typeof project);

    expect(second.outcome).toBe("runtime_reused");
  });

  it("stops and restarts runtime", async () => {
    const { projects, project } = await makeRegistry();
    const runtime = createOnCallRuntimeController({ projects });
    await runtime.ensureProjectRuntime(project);

    const stopped = await runtime.stopProjectRuntime(project);
    expect(stopped.status).toBe("stopped");

    const restarted = await runtime.restartProjectRuntime(project);
    expect(restarted.status).toBe("running");
  });

  it("reconciles stale runtime metadata", async () => {
    const { projects, project } = await makeRegistry();
    await projects.updateProjectRuntimeMetadata(project.id, {
      runtimeStatus: "running",
      containerId: "dead-container",
      containerName: "teleclaw-billing",
    });

    const provider = {
      ensure: vi.fn(),
      inspect: vi.fn().mockResolvedValue({
        status: "error",
        containerId: null,
        containerName: "teleclaw-billing",
        runtimeFamily: "node",
        workspacePath: project.workspacePath,
        checkedAt: new Date().toISOString(),
        error: "container_not_found",
      }),
      getStatus: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      restart: vi.fn(),
      validate: vi.fn(),
    };

    const runtime = createOnCallRuntimeController({ projects, provider: provider as never });
    const reconciled = await runtime.reconcileProjectRuntime(project);

    expect(reconciled.status).toBe("unbound");
    const persisted = await projects.getProjectById(project.id);
    expect(persisted?.containerId).toBeNull();
    expect(persisted?.runtimeStatus).toBe("unbound");
  });
});

describe("runtime provider helpers", () => {
  it("builds deterministic container names", () => {
    expect(buildDeterministicContainerName("Billing API")).toBe("teleclaw-billing-api");
  });

  it("infers runtime family", () => {
    expect(inferRuntimeFamily({ language: "py", runtimeFamily: null } as never)).toBe("python");
  });

  it("selects image from runtime family", () => {
    expect(
      selectImage("node", {
        imageNode: "node:test",
        imagePython: "python:test",
        imageGeneric: "ubuntu:test",
      } as never),
    ).toBe("node:test");
  });
});

describe("workspace runtime hints", () => {
  it("detects node family from package.json hint", async () => {
    const { projects, project, tmpDir } = await makeRegistry();
    await mkdir(path.join(tmpDir, "billing"), { recursive: true });
    await writeFile(path.join(tmpDir, "billing", "package.json"), '{"name":"billing"}\n', "utf8");
    const runtime = createOnCallRuntimeController({ projects });

    await runtime.ensureProjectRuntime(project);

    const persisted = await projects.getProjectById("billing");
    expect(persisted?.runtimeFamily).toBe("node");
  });
});
