import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createOnCallMemoryStore } from "./index.js";

describe("createOnCallMemoryStore", () => {
  it("appends events and reloads from disk", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-memory-"));
    const storePath = path.join(tmpDir, "memory.json");

    const memory = createOnCallMemoryStore({ storePath });
    await memory.appendEvent({
      id: "e1",
      atMs: 1,
      sessionId: "session:1",
      projectId: "billing",
      type: "inbound_user_message",
      text: "status billing",
      channel: "telegram",
      userId: "u1",
    });

    const reloaded = createOnCallMemoryStore({ storePath });
    const events = await reloaded.listRecentEvents("session:1", 10, "billing");

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("inbound_user_message");
  });

  it("persists summary, structured state, and durable facts", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-memory-"));
    const storePath = path.join(tmpDir, "memory.json");

    const memory = createOnCallMemoryStore({ storePath });
    await memory.setSummary("session:1", "Billing API summary", "billing");
    await memory.setStructuredState(
      "session:1",
      {
        currentGoal: "stabilize tests",
        filesChanged: ["src/billing/api.ts"],
        testsFailing: ["billing service test"],
      },
      "billing",
    );
    await memory.mergeDurableFacts(
      "session:1",
      {
        acceptedDecisions: ["Use explicit idempotency keys"],
        architectureConstraints: ["No cross-project imports"],
      },
      "billing",
    );

    const loaded = await createOnCallMemoryStore({ storePath }).read("session:1", "billing");

    expect(loaded.rollingSummary).toContain("Billing API");
    expect(loaded.structuredState.filesChanged).toContain("src/billing/api.ts");
    expect(loaded.durableFacts.acceptedDecisions).toContain("Use explicit idempotency keys");
  });

  it("compacts events while preserving key state and durable facts", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "teleclaw-memory-"));
    const storePath = path.join(tmpDir, "memory.json");

    const memory = createOnCallMemoryStore({ storePath });
    await memory.mergeDurableFacts(
      "session:1",
      {
        userPreferences: ["keep replies concise"],
      },
      "billing",
    );

    for (let index = 0; index < 45; index += 1) {
      await memory.appendEvent({
        id: `p-${index}`,
        atMs: index,
        sessionId: "session:1",
        projectId: "billing",
        type: "worker_status_progress",
        progress: {
          atMs: index,
          kind: index % 2 === 0 ? "tests_passed" : "tests_failed",
          message: `progress ${index}`,
          filesChanged: [`src/billing/file-${index}.ts`],
          testsPassing: index % 2 === 0 ? [`test-${index}`] : [],
          testsFailing: index % 2 === 1 ? [`test-${index}`] : [],
          nextSuggestedStep: "run focused test",
        },
      });
    }

    const result = await memory.compactSessionMemory("session:1", "billing");
    const loaded = await memory.read("session:1", "billing");
    const events = await memory.listRecentEvents("session:1", 200, "billing");

    expect(result.compactedEvents).toBeGreaterThan(0);
    expect(loaded.structuredState.nextSuggestedStep).toBe("run focused test");
    expect(loaded.durableFacts.userPreferences).toContain("keep replies concise");
    expect(events.length).toBeLessThanOrEqual(31);
  });
});
