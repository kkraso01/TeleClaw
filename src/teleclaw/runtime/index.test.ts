import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createOnCallProjectRegistry } from "../projects/index.js";
import { createOnCallRuntimeController } from "./index.js";

async function makeRegistry() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-runtime-"));
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

  return { projects, project };
}

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
});
