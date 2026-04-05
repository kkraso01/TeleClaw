import { describe, expect, it } from "vitest";
import { resolveOnCallIntent } from "./index.js";

describe("resolveOnCallIntent", () => {
  it("detects status and project reference", () => {
    const intent = resolveOnCallIntent({
      channel: "telegram",
      userId: "u1",
      body: "status project api-gateway",
      timestampMs: Date.now(),
    });

    expect(intent.action).toBe("status");
    expect(intent.projectRef).toBe("api-gateway");
    expect(intent.replyMode).toBe("text");
  });

  it("detects voice reply request", () => {
    const intent = resolveOnCallIntent({
      channel: "telegram",
      userId: "u1",
      body: "resume and reply with voice",
      timestampMs: Date.now(),
    });

    expect(intent.action).toBe("resume");
    expect(intent.replyMode).toBe("voice");
  });
});
