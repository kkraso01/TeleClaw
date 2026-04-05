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
  chatId?: string;
  sessionKey?: string;
  body: string;
  transcript?: string;
  timestampMs: number;
};

export type OnCallProjectStatus = "active" | "paused" | "archived";

export type OnCallProject = {
  id: string;
  name: string;
  aliases: string[];
  language: string | null;
  workspacePath: string;
  containerId: string | null;
  runtimeFamily: string | null;
  defaultReplyMode: OnCallReplyMode | null;
  status: OnCallProjectStatus;
  createdAt: string;
  updatedAt: string;
  description?: string;
  tags?: string[];
  allowedMounts?: string[];
  envProfile?: string;
};

export type OnCallWorkerBinding = {
  workerType: string;
  workerSessionId: string | null;
  containerId: string | null;
};

export type OnCallSessionPhase =
  | "idle"
  | "intake"
  | "planning"
  | "implementing"
  | "testing"
  | "blocked"
  | "awaiting_approval"
  | "reporting"
  | "paused";

export type OnCallSessionState = {
  sessionId: string;
  chatId: string;
  userId: string | null;
  activeProjectId: string | null;
  workerBinding: OnCallWorkerBinding;
  currentPhase: OnCallSessionPhase;
  summary: string;
  durableFacts: string[];
  structuredState: Record<string, unknown>;
  recentActions: string[];
  artifactRefs: string[];
  lastActiveAt: string;
  createdAt: string;
  updatedAt: string;
};

export type OnCallMemoryState = {
  rollingSummary: string;
  structuredState: Record<string, unknown>;
  durableFacts: {
    preferredReplyMode?: OnCallReplyMode;
    preferredProjectId?: string;
    pinnedNotes: string[];
  };
};

export type OnCallWorkerResult = {
  status: "ok" | "busy" | "error";
  text: string;
  summary?: string;
  workerSessionId?: string;
  meta?: Record<string, unknown>;
};

export type OnCallPolicyErrorCode =
  | "workspace_disallowed"
  | "project_archived"
  | "project_paused"
  | "mount_disallowed"
  | "project_required"
  | "container_binding_required";

export type OnCallPolicyError = {
  code: OnCallPolicyErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export type OnCallRouteOutcome =
  | {
      type: "success";
      replyMode: OnCallReplyMode;
      projectId: string;
      projectName: string;
      sessionId: string;
      text: string;
      execution: {
        action: OnCallAction;
        status: OnCallWorkerResult["status"];
      };
      summary?: string;
    }
  | {
      type: "needs_clarification";
      replyMode: OnCallReplyMode;
      text: string;
      candidates: Array<{ id: string; name: string }>;
    }
  | {
      type: "project_not_found";
      replyMode: OnCallReplyMode;
      text: string;
      requestedRef?: string;
    }
  | {
      type: "blocked_by_policy";
      replyMode: OnCallReplyMode;
      text: string;
      projectId?: string;
      policy: OnCallPolicyError;
    }
  | {
      type: "invalid_project_binding";
      replyMode: OnCallReplyMode;
      text: string;
      reason: string;
    }
  | {
      type: "worker_error";
      replyMode: OnCallReplyMode;
      text: string;
      projectId: string;
    };
