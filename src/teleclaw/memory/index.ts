import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  OnCallCompactionResult,
  OnCallDurableFacts,
  OnCallMemoryEvent,
  OnCallMemoryState,
  OnCallStructuredState,
} from "../types.js";

const DEFAULT_MEMORY_FILENAME = "memory.json";
const DEFAULT_RECENT_EVENT_LIMIT = 40;
const DEFAULT_COMPACTION_TAIL_SIZE = 30;

type OnCallMemorySlice = {
  rollingSummary: string;
  structuredState: OnCallStructuredState;
  durableFacts: OnCallDurableFacts;
};

type OnCallMemorySessionRecord = {
  sessionId: string;
  events: OnCallMemoryEvent[];
  session: OnCallMemorySlice;
  projects: Record<string, OnCallMemorySlice>;
  updatedAt: string;
};

type OnCallMemoryStoreShape = {
  sessions: Record<string, OnCallMemorySessionRecord>;
};

type OnCallMemoryConfig = {
  storePath: string;
};

export type OnCallMemoryStore = {
  appendEvent: (event: OnCallMemoryEvent) => Promise<void>;
  listRecentEvents: (
    sessionId: string,
    limit?: number,
    projectId?: string,
  ) => Promise<OnCallMemoryEvent[]>;
  getSummary: (sessionId: string, projectId?: string) => Promise<string>;
  setSummary: (sessionId: string, summary: string, projectId?: string) => Promise<void>;
  mergeDurableFacts: (
    sessionId: string,
    facts: Partial<OnCallDurableFacts>,
    projectId?: string,
  ) => Promise<OnCallDurableFacts>;
  getStructuredState: (sessionId: string, projectId?: string) => Promise<OnCallStructuredState>;
  setStructuredState: (
    sessionId: string,
    state: Partial<OnCallStructuredState>,
    projectId?: string,
  ) => Promise<OnCallStructuredState>;
  read: (sessionId: string, projectId?: string) => Promise<OnCallMemoryState>;
  compactSessionMemory: (sessionId: string, projectId?: string) => Promise<OnCallCompactionResult>;
};

const EMPTY_DURABLE_FACTS: OnCallDurableFacts = {
  pinnedNotes: [],
  userPreferences: [],
  architectureConstraints: [],
  securityConstraints: [],
  acceptedDecisions: [],
};

const EMPTY_STRUCTURED_STATE: OnCallStructuredState = {
  filesChanged: [],
  testsPassing: [],
  testsFailing: [],
  blockers: [],
  installStatus: "unknown",
  testStatus: "unknown",
  buildStatus: "unknown",
  lastTestRunStatus: "unknown",
  lastBuildStatus: "unknown",
  currentExecutionPhase: "idle",
  lastKnownRepoDirtyState: "unknown",
  lastKnownChangedFileCount: 0,
};

function nowIso() {
  return new Date().toISOString();
}

function resolveStorePath(): string {
  const dataDir = process.env.TELECLAW_DATA_DIR ?? path.resolve(process.cwd(), ".teleclaw");
  return process.env.TELECLAW_MEMORY_STORE_PATH ?? path.join(dataDir, DEFAULT_MEMORY_FILENAME);
}

function mergeUnique(current: string[], next: string[] | undefined): string[] {
  if (!next || next.length === 0) {
    return [...current];
  }
  return [...new Set([...current, ...next.filter(Boolean)])];
}

function defaultSlice(): OnCallMemorySlice {
  return {
    rollingSummary: "",
    structuredState: {
      ...EMPTY_STRUCTURED_STATE,
    },
    durableFacts: {
      ...EMPTY_DURABLE_FACTS,
    },
  };
}

async function readStore(config: OnCallMemoryConfig): Promise<OnCallMemoryStoreShape> {
  try {
    const raw = await readFile(config.storePath, "utf8");
    const parsed = JSON.parse(raw) as OnCallMemoryStoreShape;
    return {
      sessions: parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {},
    };
  } catch {
    return { sessions: {} };
  }
}

async function writeStore(
  config: OnCallMemoryConfig,
  store: OnCallMemoryStoreShape,
): Promise<void> {
  await mkdir(path.dirname(config.storePath), { recursive: true });
  await writeFile(config.storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function getOrCreateSessionRecord(
  store: OnCallMemoryStoreShape,
  sessionId: string,
): OnCallMemorySessionRecord {
  const existing = store.sessions[sessionId];
  if (existing) {
    return {
      ...existing,
      events: Array.isArray(existing.events) ? existing.events : [],
      session: existing.session ?? defaultSlice(),
      projects: existing.projects ?? {},
    };
  }

  const created: OnCallMemorySessionRecord = {
    sessionId,
    events: [],
    session: defaultSlice(),
    projects: {},
    updatedAt: nowIso(),
  };
  store.sessions[sessionId] = created;
  return created;
}

function getSlice(record: OnCallMemorySessionRecord, projectId?: string): OnCallMemorySlice {
  if (!projectId) {
    return record.session;
  }

  const existing = record.projects[projectId];
  if (existing) {
    return existing;
  }

  const created = defaultSlice();
  record.projects[projectId] = created;
  return created;
}

function mergeFacts(
  current: OnCallDurableFacts,
  next: Partial<OnCallDurableFacts>,
): OnCallDurableFacts {
  return {
    preferredReplyMode: next.preferredReplyMode ?? current.preferredReplyMode,
    preferredProjectId: next.preferredProjectId ?? current.preferredProjectId,
    pinnedNotes: mergeUnique(current.pinnedNotes, next.pinnedNotes),
    userPreferences: mergeUnique(current.userPreferences, next.userPreferences),
    architectureConstraints: mergeUnique(
      current.architectureConstraints,
      next.architectureConstraints,
    ),
    securityConstraints: mergeUnique(current.securityConstraints, next.securityConstraints),
    acceptedDecisions: mergeUnique(current.acceptedDecisions, next.acceptedDecisions),
  };
}

function mergeStructuredState(
  current: OnCallStructuredState,
  next: Partial<OnCallStructuredState>,
): OnCallStructuredState {
  const installStatusInput = next.installStatus as string | undefined;
  const testStatusInput = next.testStatus as string | undefined;
  const buildStatusInput = next.buildStatus as string | undefined;
  const lastTestStatusInput = next.lastTestRunStatus as string | undefined;
  const lastBuildStatusInput = next.lastBuildStatus as string | undefined;

  const normalizedInstallStatus =
    installStatusInput === "running"
      ? "started"
      : installStatusInput === "passed"
        ? "succeeded"
        : next.installStatus;
  const normalizedTestStatus =
    testStatusInput === "running"
      ? "started"
      : testStatusInput === "succeeded"
        ? "passed"
        : next.testStatus;
  const normalizedBuildStatus =
    buildStatusInput === "running"
      ? "started"
      : buildStatusInput === "passed"
        ? "succeeded"
        : next.buildStatus;
  const normalizedLastTestRunStatus =
    lastTestStatusInput === "running"
      ? "started"
      : lastTestStatusInput === "succeeded"
        ? "passed"
        : next.lastTestRunStatus;
  const normalizedLastBuildStatus =
    lastBuildStatusInput === "running"
      ? "started"
      : lastBuildStatusInput === "passed"
        ? "succeeded"
        : next.lastBuildStatus;

  return {
    ...current,
    ...next,
    ...(normalizedInstallStatus ? { installStatus: normalizedInstallStatus } : {}),
    ...(normalizedTestStatus ? { testStatus: normalizedTestStatus } : {}),
    ...(normalizedBuildStatus ? { buildStatus: normalizedBuildStatus } : {}),
    ...(normalizedLastTestRunStatus ? { lastTestRunStatus: normalizedLastTestRunStatus } : {}),
    ...(normalizedLastBuildStatus ? { lastBuildStatus: normalizedLastBuildStatus } : {}),
    filesChanged: mergeUnique(current.filesChanged, next.filesChanged),
    testsPassing: mergeUnique(current.testsPassing, next.testsPassing),
    testsFailing: mergeUnique(current.testsFailing, next.testsFailing),
    blockers: mergeUnique(current.blockers, next.blockers),
  };
}

function getDefaultSummaryText(record: OnCallMemorySessionRecord, projectId?: string): string {
  const scope = projectId ? `project ${projectId}` : "session";
  const eventCount = record.events.filter(
    (event) => !projectId || event.projectId === projectId,
  ).length;
  return `No rolling summary yet for this ${scope}. ${eventCount} event(s) captured.`;
}

function eventSort(a: OnCallMemoryEvent, b: OnCallMemoryEvent): number {
  return a.atMs - b.atMs;
}

function buildHeuristicCompaction(params: {
  events: OnCallMemoryEvent[];
  previousSummary: string;
  structuredState: OnCallStructuredState;
  durableFacts: OnCallDurableFacts;
}): OnCallCompactionResult {
  const { events, previousSummary, structuredState, durableFacts } = params;

  const scoped = [...events].toSorted(eventSort);
  const compactedEvents = Math.max(scoped.length - DEFAULT_COMPACTION_TAIL_SIZE, 0);
  const toCompact = scoped.slice(0, compactedEvents);

  let currentGoal = structuredState.currentGoal;
  let activeTask = structuredState.activeTask;
  let currentPhase = structuredState.currentPhase;
  let currentExecutionPhase = structuredState.currentExecutionPhase;
  let lastWorkerAction = structuredState.lastWorkerAction;
  let nextSuggestedStep = structuredState.nextSuggestedStep;
  let blockerReason = structuredState.blockerReason;
  let lastErrorSummary = structuredState.lastErrorSummary;

  let filesChanged = [...structuredState.filesChanged];
  let testsPassing = [...structuredState.testsPassing];
  let testsFailing = [...structuredState.testsFailing];
  let blockers = [...structuredState.blockers];

  const progressLines: string[] = [];
  const decisions: string[] = [];

  for (const event of toCompact) {
    if (event.type === "inbound_user_message") {
      currentGoal = event.text;
      activeTask = event.text;
    }

    if (event.type === "worker_task_start") {
      activeTask = event.instruction;
      lastWorkerAction = event.action;
    }

    if (event.type === "worker_status_progress") {
      currentPhase = event.progress.phase ?? currentPhase;
      currentExecutionPhase = event.progress.executionPhase ?? currentExecutionPhase;
      lastWorkerAction = event.progress.kind;
      nextSuggestedStep = event.progress.nextSuggestedStep ?? nextSuggestedStep;
      blockerReason = event.progress.blockerReason ?? blockerReason;
      lastErrorSummary = event.progress.errorSummary ?? lastErrorSummary;
      filesChanged = mergeUnique(filesChanged, event.progress.filesChanged);
      testsPassing = mergeUnique(testsPassing, event.progress.testsPassing);
      testsFailing = mergeUnique(testsFailing, event.progress.testsFailing);
      blockers = mergeUnique(blockers, event.progress.blockers);
      progressLines.push(event.progress.message);
    }

    if (event.type === "worker_summary") {
      progressLines.push(event.text);
    }

    if (event.type === "policy_block") {
      blockers = mergeUnique(blockers, [event.message]);
    }

    if (event.type === "router_decision" && event.outcomeType === "success") {
      decisions.push(event.text);
    }
  }

  const lines = [
    previousSummary.trim(),
    currentGoal ? `Goal: ${currentGoal}` : "",
    activeTask ? `Active task: ${activeTask}` : "",
    progressLines.length > 0 ? `Progress: ${progressLines.slice(-3).join(" | ")}` : "",
    testsPassing.length > 0 ? `Passing tests: ${testsPassing.join(", ")}` : "",
    testsFailing.length > 0 ? `Failing tests: ${testsFailing.join(", ")}` : "",
    blockers.length > 0 ? `Blockers: ${blockers.join("; ")}` : "",
    nextSuggestedStep ? `Next step: ${nextSuggestedStep}` : "",
    decisions.length > 0 ? `Accepted decisions: ${decisions.slice(-3).join("; ")}` : "",
  ].filter(Boolean);

  // TODO(teleclaw): Replace heuristic line synthesis with LLM-based summarization once we can budget a summarization model call.
  const summary = lines.join("\n").trim();

  return {
    summary,
    compactedEvents,
    structuredState: {
      ...structuredState,
      currentGoal,
      activeTask,
      currentPhase,
      currentExecutionPhase,
      lastWorkerAction,
      nextSuggestedStep,
      blockerReason,
      lastErrorSummary,
      filesChanged,
      testsPassing,
      testsFailing,
      blockers,
      lastCompactedAt: nowIso(),
    },
    durableFacts: {
      ...durableFacts,
      acceptedDecisions: mergeUnique(durableFacts.acceptedDecisions, decisions),
    },
  };
}

export function createOnCallMemoryStore(
  config: Partial<OnCallMemoryConfig> = {},
): OnCallMemoryStore {
  const resolvedConfig: OnCallMemoryConfig = {
    storePath: resolveStorePath(),
    ...config,
  };

  return {
    async appendEvent(event) {
      const store = await readStore(resolvedConfig);
      const record = getOrCreateSessionRecord(store, event.sessionId);
      record.events = [...record.events, event].toSorted(eventSort);
      record.updatedAt = nowIso();
      store.sessions[event.sessionId] = record;
      await writeStore(resolvedConfig, store);
    },

    async listRecentEvents(sessionId, limit = DEFAULT_RECENT_EVENT_LIMIT, projectId) {
      const store = await readStore(resolvedConfig);
      const record = store.sessions[sessionId];
      if (!record) {
        return [];
      }
      return record.events
        .filter((event) => !projectId || event.projectId === projectId)
        .toSorted(eventSort)
        .slice(-Math.max(limit, 1));
    },

    async getSummary(sessionId, projectId) {
      const store = await readStore(resolvedConfig);
      const record = store.sessions[sessionId];
      if (!record) {
        return "";
      }
      const slice = getSlice(record, projectId);
      return slice.rollingSummary || getDefaultSummaryText(record, projectId);
    },

    async setSummary(sessionId, summary, projectId) {
      const store = await readStore(resolvedConfig);
      const record = getOrCreateSessionRecord(store, sessionId);
      const slice = getSlice(record, projectId);
      slice.rollingSummary = summary;
      record.updatedAt = nowIso();
      store.sessions[sessionId] = record;
      await writeStore(resolvedConfig, store);
    },

    async mergeDurableFacts(sessionId, facts, projectId) {
      const store = await readStore(resolvedConfig);
      const record = getOrCreateSessionRecord(store, sessionId);
      const slice = getSlice(record, projectId);
      slice.durableFacts = mergeFacts(slice.durableFacts, facts);
      record.updatedAt = nowIso();
      store.sessions[sessionId] = record;
      await writeStore(resolvedConfig, store);
      return slice.durableFacts;
    },

    async getStructuredState(sessionId, projectId) {
      const store = await readStore(resolvedConfig);
      const record = store.sessions[sessionId];
      if (!record) {
        return { ...EMPTY_STRUCTURED_STATE };
      }
      return getSlice(record, projectId).structuredState;
    },

    async setStructuredState(sessionId, state, projectId) {
      const store = await readStore(resolvedConfig);
      const record = getOrCreateSessionRecord(store, sessionId);
      const slice = getSlice(record, projectId);
      slice.structuredState = mergeStructuredState(slice.structuredState, state);
      record.updatedAt = nowIso();
      store.sessions[sessionId] = record;
      await writeStore(resolvedConfig, store);
      return slice.structuredState;
    },

    async read(sessionId, projectId) {
      const store = await readStore(resolvedConfig);
      const record = store.sessions[sessionId];
      if (!record) {
        return {
          rollingSummary: "",
          structuredState: { ...EMPTY_STRUCTURED_STATE },
          durableFacts: { ...EMPTY_DURABLE_FACTS },
        };
      }
      const slice = getSlice(record, projectId);
      return {
        rollingSummary: slice.rollingSummary,
        structuredState: slice.structuredState,
        durableFacts: slice.durableFacts,
      };
    },

    async compactSessionMemory(sessionId, projectId) {
      const store = await readStore(resolvedConfig);
      const record = getOrCreateSessionRecord(store, sessionId);
      const slice = getSlice(record, projectId);
      const scopedEvents = record.events.filter(
        (event) => !projectId || event.projectId === projectId,
      );
      const result = buildHeuristicCompaction({
        events: scopedEvents,
        previousSummary: slice.rollingSummary,
        structuredState: slice.structuredState,
        durableFacts: slice.durableFacts,
      });

      slice.rollingSummary = result.summary;
      slice.structuredState = result.structuredState;
      slice.durableFacts = result.durableFacts;

      if (result.compactedEvents > 0) {
        const keepFromIndex = scopedEvents.length - DEFAULT_COMPACTION_TAIL_SIZE;
        const keptScoped = scopedEvents.slice(Math.max(keepFromIndex, 0));
        record.events = record.events.filter((event) => {
          if (projectId && event.projectId !== projectId) {
            return true;
          }
          return keptScoped.some((kept) => kept.id === event.id);
        });
      }

      const compactionEvent: OnCallMemoryEvent = {
        id: `mem:${Date.now()}:compaction`,
        atMs: Date.now(),
        sessionId,
        projectId,
        type: "compaction",
        summary: result.summary,
        compactedEvents: result.compactedEvents,
      };
      record.events.push(compactionEvent);
      record.updatedAt = nowIso();
      store.sessions[sessionId] = record;
      await writeStore(resolvedConfig, store);
      return result;
    },
  };
}
