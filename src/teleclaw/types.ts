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
  inputType?: "text" | "voice";
  audioUrl?: string;
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

export type OnCallDurableFacts = {
  preferredReplyMode?: OnCallReplyMode;
  preferredProjectId?: string;
  pinnedNotes: string[];
  userPreferences: string[];
  architectureConstraints: string[];
  securityConstraints: string[];
  acceptedDecisions: string[];
};

export type OnCallStructuredState = {
  currentGoal?: string;
  currentPhase?: OnCallSessionPhase;
  activeTask?: string;
  filesChanged: string[];
  testsPassing: string[];
  testsFailing: string[];
  blockers: string[];
  lastWorkerAction?: string;
  nextSuggestedStep?: string;
  lastCompactedAt?: string;
} & Record<string, unknown>;

export type OnCallMemoryState = {
  rollingSummary: string;
  structuredState: OnCallStructuredState;
  durableFacts: OnCallDurableFacts;
};

export type OnCallWorkerProgressKind =
  | "task_started"
  | "planning_started"
  | "implementation_started"
  | "testing_started"
  | "dependency_install"
  | "tests_failed"
  | "tests_passed"
  | "summary_ready"
  | "worker_error";

export type OnCallWorkerProgressEvent = {
  atMs: number;
  kind: OnCallWorkerProgressKind;
  message: string;
  phase?: OnCallSessionPhase;
  filesChanged?: string[];
  testsPassing?: string[];
  testsFailing?: string[];
  blockers?: string[];
  nextSuggestedStep?: string;
};

export type OnCallMemoryEvent =
  | {
      id: string;
      atMs: number;
      sessionId: string;
      projectId?: string;
      type: "inbound_user_message";
      text: string;
      channel: "telegram";
      userId: string;
    }
  | {
      id: string;
      atMs: number;
      sessionId: string;
      projectId?: string;
      type: "inbound_voice_message";
      audioUrl?: string;
      provider?: string;
      userId: string;
    }
  | {
      id: string;
      atMs: number;
      sessionId: string;
      projectId?: string;
      type: "inbound_voice_transcript";
      text: string;
      provider: string;
    }
  | {
      id: string;
      atMs: number;
      sessionId: string;
      projectId?: string;
      type: "resolved_intent";
      action: OnCallAction;
      instruction: string;
      projectRef?: string;
      replyMode: OnCallReplyMode;
    }
  | {
      id: string;
      atMs: number;
      sessionId: string;
      projectId?: string;
      type: "router_decision";
      outcomeType: OnCallRouteOutcome["type"];
      text: string;
    }
  | {
      id: string;
      atMs: number;
      sessionId: string;
      projectId: string;
      type: "project_switch";
      fromProjectId?: string;
      toProjectId: string;
    }
  | {
      id: string;
      atMs: number;
      sessionId: string;
      projectId: string;
      type: "worker_task_start";
      action: OnCallAction;
      instruction: string;
    }
  | {
      id: string;
      atMs: number;
      sessionId: string;
      projectId: string;
      type: "worker_status_progress";
      progress: OnCallWorkerProgressEvent;
    }
  | {
      id: string;
      atMs: number;
      sessionId: string;
      projectId: string;
      type: "worker_summary";
      text: string;
    }
  | {
      id: string;
      atMs: number;
      sessionId: string;
      projectId?: string;
      type: "policy_block";
      code: OnCallPolicyErrorCode;
      message: string;
    }
  | {
      id: string;
      atMs: number;
      sessionId: string;
      projectId?: string;
      type: "outbound_reply";
      mode: OnCallReplyMode;
      text: string;
      voiceMediaUrl?: string;
    }
  | {
      id: string;
      atMs: number;
      sessionId: string;
      projectId?: string;
      type: "compaction";
      summary: string;
      compactedEvents: number;
    };

export type OnCallCompactionResult = {
  summary: string;
  compactedEvents: number;
  structuredState: OnCallStructuredState;
  durableFacts: OnCallDurableFacts;
};

export type OnCallVoiceTranscriptResult = {
  text: string;
  provider: string;
  metadata?: Record<string, unknown>;
};

export type OnCallVoiceSynthesisResult = {
  mediaUrl: string;
  provider: string;
  metadata?: Record<string, unknown>;
};

export type OnCallWorkerResult = {
  status: "ok" | "busy" | "error";
  text: string;
  summary?: string;
  workerSessionId?: string;
  progressEvents?: OnCallWorkerProgressEvent[];
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
        source: "memory" | "worker";
      };
      summary?: string;
      voiceMediaUrl?: string;
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
