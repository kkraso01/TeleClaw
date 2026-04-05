import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createOnCallSessionManager } from "./index.js";

describe("createOnCallSessionManager", () => {
  it("persists and reloads session state", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-sessions-"));
    const storePath = path.join(tmpDir, "sessions.json");

    const sessions = createOnCallSessionManager({ storePath });
    const created = await sessions.getOrCreateSession("chat-1", "user-1");

    await sessions.bindProject(created.sessionId, "frontend");
    await sessions.setSummary(created.sessionId, "Front-end refactor in progress");
    await sessions.setStructuredState(created.sessionId, { branch: "feat/ui" });

    const reloaded = createOnCallSessionManager({ storePath });
    const loaded = await reloaded.getSessionById(created.sessionId);

    expect(loaded?.activeProjectId).toBe("frontend");
    expect(loaded?.summary).toContain("refactor");
    expect(loaded?.structuredState).toMatchObject({ branch: "feat/ui" });
  });
});
