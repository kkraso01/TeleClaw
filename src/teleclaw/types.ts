export type OnCallReplyMode = "text" | "voice";

export type OnCallAction = "task" | "resume" | "status" | "summarize";

export type OnCallIntent = {
  action: OnCallAction;
  projectRef?: string;
  instruction: string;
  replyMode: OnCallReplyMode;
};

export type OnCallInput = {
  channel: "telegram";
  userId: string;
  sessionKey?: string;
  body: string;
  transcript?: string;
  timestampMs: number;
};

export type OnCallProject = {
  id: string;
  aliases: string[];
  workspaceRoot: string;
  containerId: string;
};

export type OnCallSessionState = {
  sessionKey: string;
  projectId: string;
  userId: string;
  lastActionAtMs: number;
};

export type OnCallDurableFacts = {
  preferredReplyMode?: OnCallReplyMode;
  preferredProjectId?: string;
  pinnedNotes: string[];
};

export type OnCallMemoryState = {
  rollingSummary: string;
  structuredState: Record<string, string>;
  durableFacts: OnCallDurableFacts;
};

export type OnCallWorkerResult = {
  status: "ok" | "busy" | "error";
  text: string;
};

export type OnCallRouteResult = {
  project: OnCallProject;
  session: OnCallSessionState;
};
