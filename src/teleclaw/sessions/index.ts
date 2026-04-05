import type { OnCallSessionState } from "../types.js";

export type OnCallSessionStore = {
  getOrCreate: (params: {
    sessionKey?: string;
    userId: string;
    projectId: string;
  }) => OnCallSessionState;
};

export function createOnCallSessionStore(): OnCallSessionStore {
  const sessions = new Map<string, OnCallSessionState>();

  return {
    getOrCreate: ({ sessionKey, userId, projectId }) => {
      const resolvedSessionKey = sessionKey ?? `${userId}:${projectId}`;
      const existing = sessions.get(resolvedSessionKey);
      if (existing) {
        existing.lastActionAtMs = Date.now();
        existing.projectId = projectId;
        return existing;
      }
      const created: OnCallSessionState = {
        sessionKey: resolvedSessionKey,
        userId,
        projectId,
        lastActionAtMs: Date.now(),
      };
      sessions.set(resolvedSessionKey, created);
      return created;
    },
  };
}
