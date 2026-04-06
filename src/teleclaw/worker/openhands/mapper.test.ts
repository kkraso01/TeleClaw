import { describe, expect, it } from "vitest";
import { toOpenHandsInstruction } from "./mapper.js";

describe("toOpenHandsInstruction", () => {
  it("uses explicit instruction when provided", () => {
    expect(toOpenHandsInstruction("task", "fix billing tests", undefined)).toBe(
      "fix billing tests",
    );
  });

  it("builds fallback status instruction", () => {
    expect(toOpenHandsInstruction("status", undefined, undefined)).toContain("status");
  });

  it("uses summary for resume when available", () => {
    expect(
      toOpenHandsInstruction("resume", undefined, {
        summary: "last step failed while running pnpm test",
      }),
    ).toContain("last step failed");
  });
});
