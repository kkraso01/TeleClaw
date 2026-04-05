import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createOnCallProjectRegistry } from "./index.js";

describe("createOnCallProjectRegistry", () => {
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
});
