import type {
  OnCallApprovalClassification,
  OnCallPendingApproval,
  OnCallSessionState,
} from "../types.js";

function summarizeInstruction(instruction: string): string {
  const normalized = instruction.trim().replace(/\s+/g, " ");
  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 117)}...`;
}

export function createPendingApproval(params: {
  session: OnCallSessionState;
  projectId: string;
  workspacePath: string;
  runtimeFamily: string | null;
  originalInstruction: string;
  classification: OnCallApprovalClassification;
}): OnCallPendingApproval {
  const createdAt = new Date().toISOString();
  return {
    approvalId: `approval:${params.session.sessionId}:${Date.now().toString(36)}`,
    sessionId: params.session.sessionId,
    projectId: params.projectId,
    originalInstruction: params.originalInstruction,
    normalizedActionSummary: summarizeInstruction(params.originalInstruction),
    riskReason: params.classification.reason,
    classification: params.classification,
    workerContextSnapshot: {
      workerType: params.session.workerBinding.workerType,
      workerSessionId: params.session.workerBinding.workerSessionId,
    },
    runtimeContextSnapshot: {
      containerId: params.session.workerBinding.containerId,
      containerName: params.session.workerBinding.containerName,
      runtimeFamily: params.runtimeFamily,
      workspacePath: params.workspacePath,
    },
    createdAt,
    status: "pending",
  };
}

export function renderApprovalPrompt(approval: OnCallPendingApproval): string {
  return (
    `Approval required for ${approval.projectId}: ${approval.riskReason}\n` +
    `Blocked action: ${approval.normalizedActionSummary}\n` +
    `Reply with "approve" to continue or "reject" to cancel.`
  );
}

export function renderPendingApprovalStatus(pendingApproval: OnCallPendingApproval | null): {
  text: string;
} {
  if (!pendingApproval || pendingApproval.status !== "pending") {
    return {
      text: "There is no pending approval request right now.",
    };
  }

  return {
    text:
      `I am waiting for approval on project ${pendingApproval.projectId}. ` +
      `Reason: ${pendingApproval.riskReason}. ` +
      `Action: ${pendingApproval.normalizedActionSummary}. ` +
      `Requested at ${pendingApproval.createdAt}.`,
  };
}
