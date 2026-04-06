import type { OnCallInput, OnCallIntent } from "../types.js";

const resumePattern = /^\s*(continue|resume|pick up)\b/i;
const statusPattern =
  /^\s*(status|what(?:'| i)?s the status|progress|send me a progress update|where are you stuck|is .* running)\b/i;
const summarizePattern =
  /^\s*(summarize|summary|recap|what did you do|what changed|what did you change)\b/i;
const voicePattern = /\b(reply\s+with\s+voice|voice\s+reply)\b/i;
const projectPattern =
  /\b(?:project|repo|workspace|switch\s+to|continue\s+the|continue|resume\s+the|summarize\s+the|restart\s+the|stop\s+the|start\s+the|is\s+the)\s*[:#-]?\s*([a-zA-Z0-9._-]+)/i;

const approvalStatusPattern =
  /(what are you waiting for|what needs my approval|why did you stop|what is pending|what action is blocked)/i;
const approvalApprovePattern = /^\s*(approve|yes(?:\s+continue)?|go ahead|do it|proceed|yes)\b/i;
const approvalRejectPattern =
  /^\s*(reject|cancel that|don't do it|dont do it|no|stop|deny|never mind|reject it)\b/i;

function resolveApprovalIntent(text: string): OnCallIntent["approvalIntent"] {
  if (approvalStatusPattern.test(text)) {
    return { type: "status_query" };
  }

  const approveMatch = approvalApprovePattern.test(text);
  const rejectMatch = approvalRejectPattern.test(text);
  if (approveMatch && rejectMatch) {
    return {
      type: "decision",
      ambiguous: true,
    };
  }
  if (approveMatch) {
    return {
      type: "decision",
      decision: "approve",
    };
  }
  if (rejectMatch) {
    return {
      type: "decision",
      decision: "reject",
    };
  }
  return { type: "none" };
}

export function resolveOnCallIntent(input: OnCallInput): OnCallIntent {
  const text = (input.transcript ?? input.body).trim();
  const action: OnCallIntent["action"] = resumePattern.test(text)
    ? "resume"
    : statusPattern.test(text)
      ? "status"
      : summarizePattern.test(text)
        ? "summarize"
        : "task";

  const projectRefMatch = text.match(projectPattern);

  return {
    action,
    instruction: text,
    projectRef: projectRefMatch?.[1],
    replyMode: voicePattern.test(text) ? "voice" : "text",
    approvalIntent: resolveApprovalIntent(text),
  };
}
