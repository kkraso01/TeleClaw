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
export type OnCallRuntimeStatus = "unbound" | "starting" | "running" | "stopped" | "error";
export type OnCallBootstrapStatus = "uninitialized" | "bootstrapping" | "ready" | "error";
export type OnCallRepoStatus = "missing" | "present" | "dirty" | "clean" | "error";

export type OnCallExecutionProfile = {
  installCommand: string;
  testCommand: string;
  lintCommand: string;
  buildCommand: string;
  runCommand: string;
  packageManager: "npm" | "pnpm" | "yarn" | "uv" | "pip" | "generic";
  preferredShell: string;
};

export type OnCallProjectRepoState = {
  repoUrl: string | null;
  repoStatus: OnCallRepoStatus;
  branch: string | null;
  lastRepoSyncAt: string | null;
  repoError: string | null;
};

export type OnCallProjectBootstrapState = OnCallProjectRepoState & {
  bootstrapStatus: OnCallBootstrapStatus;
  bootstrapError: string | null;
};

export type OnCallProject = {
  id: string;
  name: string;
  aliases: string[];
  language: string | null;
  workspacePath: string;
  containerId: string | null;
  containerName: string | null;
  runtimeStatus: OnCallRuntimeStatus;
  runtimeFamily: string | null;
  defaultReplyMode: OnCallReplyMode | null;
  status: OnCallProjectStatus;
  createdAt: string;
  updatedAt: string;
  lastRuntimeStartAt: string | null;
  lastRuntimeCheckAt: string | null;
  runtimeError: string | null;
  workspaceBootstrappedAt: string | null;
  workspaceBootstrapError: string | null;
  bootstrapStatus: OnCallBootstrapStatus;
  bootstrapError: string | null;
  repoUrl: string | null;
  repoStatus: OnCallRepoStatus;
  branch: string | null;
  lastRepoSyncAt: string | null;
  repoError: string | null;
  executionProfile: OnCallExecutionProfile;
  description?: string;
  tags?: string[];
  allowedMounts?: string[];
  envProfile?: string;
};

export type OnCallWorkerBinding = {
  workerType: string;
  workerSessionId: string | null;
  containerId: string | null;
  containerName: string | null;
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
  installStatus?: "unknown" | "running" | "passed" | "failed";
  lastTestRunStatus?: "unknown" | "running" | "passed" | "failed";
  lastBuildStatus?: "unknown" | "running" | "passed" | "failed";
  filesChangedSummary?: string;
  lastSummarizedOutput?: string;
  currentBlocker?: string;
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
  | "task_resumed"
  | "planning_started"
  | "implementation_started"
  | "testing_started"
  | "build_started"
  | "build_finished"
  | "dependency_install"
  | "dependency_install_finished"
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

export type OnCallRuntimeEventType =
  | "runtime.ensure_requested"
  | "runtime.inspect_started"
  | "runtime.inspect_succeeded"
  | "runtime.created"
  | "runtime.started"
  | "runtime.reused"
  | "runtime.stopped"
  | "runtime.restarted"
  | "runtime.reconciled"
  | "runtime.stale"
  | "runtime.bootstrap_completed"
  | "runtime.bootstrap_failed"
  | "runtime.validation_failed"
  | "runtime.error";

export type OnCallExecutionEventType =
  | "project.created"
  | "project.bootstrapped"
  | "repo.cloned"
  | "repo.initialized"
  | "repo.inspected"
  | "repo.sync_requested"
  | "execution.install_started"
  | "execution.install_finished"
  | "execution.test_started"
  | "execution.test_finished"
  | "execution.build_started"
  | "execution.build_finished"
  | "execution.blocked";

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
      type: "runtime_event";
      eventType: OnCallRuntimeEventType;
      status: OnCallRuntimeStatus;
      containerId?: string | null;
      containerName?: string | null;
      message: string;
    }
  | {
      id: string;
      atMs: number;
      sessionId: string;
      projectId?: string;
      type: "teleclaw_event";
      eventType: OnCallExecutionEventType;
      message: string;
      details?: Record<string, unknown>;
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
      projectId: string;
      type: "approval_requested";
      instruction: string;
      reason: string;
      matchedRule: OnCallApprovalClassification["matchedRule"];
      riskLevel: OnCallApprovalRiskLevel;
    }
  | {
      id: string;
      atMs: number;
      sessionId: string;
      projectId: string;
      type: "approval_decision";
      decision: "granted" | "rejected";
      reason: string;
      matchedRule: OnCallApprovalClassification["matchedRule"];
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
  phase?: OnCallSessionPhase;
  blockerReason?: string;
  nextSuggestedStep?: string;
  filesChanged?: string[];
  progressEvents?: OnCallWorkerProgressEvent[];
  meta?: Record<string, unknown>;
};

export type OnCallApprovalRiskLevel = "low" | "medium" | "high";
export type OnCallApprovalPolicyDecision = "allowed" | "requires_approval" | "blocked";

export type OnCallApprovalClassification = {
  decision: OnCallApprovalPolicyDecision;
  reason: string;
  matchedRule:
    | "dangerous_shell"
    | "force_reset"
    | "destructive_branch"
    | "delete_files"
    | "dependency_removal"
    | "mass_cleanup"
    | "none";
  riskLevel: OnCallApprovalRiskLevel;
  requiresExplicitApproval: boolean;
};

export type OnCallPolicyErrorCode =
  | "workspace_disallowed"
  | "project_archived"
  | "project_paused"
  | "project_name_invalid"
  | "workspace_name_invalid"
  | "mount_disallowed"
  | "repo_url_invalid"
  | "repo_action_disallowed"
  | "project_required"
  | "runtime_family_disallowed"
  | "runtime_attach_failed"
  | "runtime_unavailable"
  | "approval_required"
  | "destructive_action_blocked";

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
        source: "memory" | "worker" | "runtime";
      };
      runtimeOutcome?: "runtime_started" | "runtime_reused";
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
      type: "runtime_missing" | "runtime_invalid" | "runtime_error";
      replyMode: OnCallReplyMode;
      text: string;
      projectId: string;
      status?: OnCallRuntimeStatus;
      reason: string;
    }
  | {
      type: "worker_error";
      replyMode: OnCallReplyMode;
      text: string;
      projectId: string;
    }
  | {
      type: "approval_required";
      replyMode: OnCallReplyMode;
      text: string;
      projectId: string;
      approval: OnCallApprovalClassification;
    };
