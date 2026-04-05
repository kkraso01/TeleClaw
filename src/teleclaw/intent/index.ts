import type { OnCallInput, OnCallIntent } from "../types.js";

const resumePattern = /^\s*(continue|resume|pick up)\b/i;
const statusPattern = /^\s*(status|what(?:'| i)?s the status|progress)\b/i;
const summarizePattern = /^\s*(summarize|summary|recap)\b/i;
const voicePattern = /\b(reply\s+with\s+voice|voice\s+reply)\b/i;
const projectPattern = /\b(?:project|repo|workspace)\s*[:#-]?\s*([a-zA-Z0-9._-]+)/i;

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
  };
}
