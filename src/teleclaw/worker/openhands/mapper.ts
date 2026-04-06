import type { OnCallWorkerContext } from "../adapter.js";
import type { OpenHandsBridgeRequest } from "./types.js";

export function toOpenHandsInstruction(
  action: OpenHandsBridgeRequest["action"],
  instruction: string | undefined,
  context: OnCallWorkerContext | undefined,
): string {
  const baseInstruction = instruction?.trim();
  if (baseInstruction) {
    return baseInstruction;
  }

  if (action === "status") {
    return "Report current implementation status, tests status, blockers, and changed files.";
  }
  if (action === "summarize") {
    return "Summarize work completed, pending tasks, tests, and blockers.";
  }

  const summary = context?.summary?.trim();
  if (action === "resume" && summary) {
    return `Resume from this context: ${summary}`;
  }
  if (action === "resume") {
    return "Resume the previous task from the current workspace state.";
  }

  return "Continue implementation using the current workspace state.";
}
