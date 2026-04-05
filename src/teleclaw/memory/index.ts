import type { OnCallMemoryState, OnCallSessionState } from "../types.js";

type OnCallMemoryEvent = {
  atMs: number;
  type: "user" | "worker" | "summary";
  text: string;
};

export type OnCallMemoryStore = {
  read: (sessionKey: string) => OnCallMemoryState;
  appendEvent: (session: OnCallSessionState, event: OnCallMemoryEvent) => void;
  updateSummary: (session: OnCallSessionState, summary: string) => void;
};

const EMPTY_MEMORY: OnCallMemoryState = {
  rollingSummary: "",
  structuredState: {},
  durableFacts: { pinnedNotes: [] },
};

export function createOnCallMemoryStore(): OnCallMemoryStore {
  const events = new Map<string, OnCallMemoryEvent[]>();
  const state = new Map<string, OnCallMemoryState>();

  return {
    read: (sessionKey) => state.get(sessionKey) ?? EMPTY_MEMORY,
    appendEvent: (session, event) => {
      const key = session.sessionKey;
      const sessionEvents = events.get(key) ?? [];
      sessionEvents.push(event);
      events.set(key, sessionEvents);
      if (!state.has(key)) {
        state.set(key, {
          rollingSummary: "",
          structuredState: {
            projectId: session.projectId,
          },
          durableFacts: { pinnedNotes: [] },
        });
      }
    },
    updateSummary: (session, summary) => {
      const memory = state.get(session.sessionKey) ?? {
        ...EMPTY_MEMORY,
        structuredState: { projectId: session.projectId },
      };
      memory.rollingSummary = summary;
      memory.structuredState.lastSummarizedAt = new Date().toISOString();
      state.set(session.sessionKey, memory);
    },
  };
}
