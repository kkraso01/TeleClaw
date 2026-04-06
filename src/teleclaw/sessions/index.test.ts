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
    await sessions.setPendingApproval(created.sessionId, {
      approvalId: "approval:1",
      sessionId: created.sessionId,
      projectId: "frontend",
      originalInstruction: "delete old files",
      normalizedActionSummary: "Delete old files",
      riskReason: "Potentially destructive file deletion.",
      classification: {
        decision: "requires_approval",
        reason: "Potentially destructive file deletion.",
        matchedRule: "delete_files",
        riskLevel: "high",
        requiresExplicitApproval: true,
      },
      workerContextSnapshot: {
        workerType: "openhands",
        workerSessionId: null,
      },
      runtimeContextSnapshot: {
        containerId: "ctr-1",
        containerName: "teleclaw-frontend",
        runtimeFamily: "node",
        workspacePath: "/tmp/workspace/frontend",
      },
      createdAt: new Date().toISOString(),
      status: "pending",
    });
    await sessions.setSummary(created.sessionId, "Front-end refactor in progress");
    await sessions.setStructuredState(created.sessionId, { branch: "feat/ui" });

    const reloaded = createOnCallSessionManager({ storePath });
    const loaded = await reloaded.getSessionById(created.sessionId);

    expect(loaded?.activeProjectId).toBe("frontend");
    expect(loaded?.pendingApproval?.status).toBe("pending");
    expect(loaded?.summary).toContain("refactor");
    expect(loaded?.structuredState).toMatchObject({ branch: "feat/ui" });
  });
});
