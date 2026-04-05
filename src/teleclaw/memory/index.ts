import type { OnCallMemoryState, OnCallSessionState } from "../types.js";

type OnCallMemoryEvent = {
  atMs: number;
  type: "user" | "worker" | "summary";
  text: string;
};

export type OnCallMemoryStore = {
  read: (sessionId: string) => OnCallMemoryState;
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
    read: (sessionId) => state.get(sessionId) ?? EMPTY_MEMORY,
    appendEvent: (session, event) => {
      const key = session.sessionId;
      const sessionEvents = events.get(key) ?? [];
      sessionEvents.push(event);
      events.set(key, sessionEvents);
      if (!state.has(key)) {
        state.set(key, {
          rollingSummary: "",
          structuredState: {
            activeProjectId: session.activeProjectId,
          },
          durableFacts: { pinnedNotes: [] },
        });
      }
    },
    updateSummary: (session, summary) => {
      const memory = state.get(session.sessionId) ?? {
        ...EMPTY_MEMORY,
        structuredState: { activeProjectId: session.activeProjectId },
      };
      memory.rollingSummary = summary;
      memory.structuredState.lastSummarizedAt = new Date().toISOString();
      state.set(session.sessionId, memory);
    },
  };
}
