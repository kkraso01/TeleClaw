import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  OnCallPendingApproval,
  OnCallSessionPhase,
  OnCallSessionState,
  OnCallWorkerBinding,
} from "../types.js";

const DEFAULT_SESSIONS_FILENAME = "sessions.json";

export type OnCallSessionManager = {
  getOrCreateSession: (chatId: string, userId?: string | null) => Promise<OnCallSessionState>;
  getSessionById: (sessionId: string) => Promise<OnCallSessionState | null>;
  updateSession: (
    sessionId: string,
    mutator: (current: OnCallSessionState) => OnCallSessionState,
  ) => Promise<OnCallSessionState | null>;
  bindProject: (sessionId: string, projectId: string | null) => Promise<OnCallSessionState | null>;
  bindWorker: (
    sessionId: string,
    workerBinding: Partial<OnCallWorkerBinding>,
  ) => Promise<OnCallSessionState | null>;
  appendRecentAction: (sessionId: string, action: string) => Promise<OnCallSessionState | null>;
  setPhase: (sessionId: string, phase: OnCallSessionPhase) => Promise<OnCallSessionState | null>;
  setSummary: (sessionId: string, summary: string) => Promise<OnCallSessionState | null>;
  setStructuredState: (
    sessionId: string,
    structuredState: Record<string, unknown>,
  ) => Promise<OnCallSessionState | null>;
  setPendingApproval: (
    sessionId: string,
    pendingApproval: OnCallPendingApproval | null,
  ) => Promise<OnCallSessionState | null>;
};

type SessionStoreShape = {
  sessions: OnCallSessionState[];
};

type SessionManagerConfig = {
  storePath: string;
};

function nowIso() {
  return new Date().toISOString();
}

function resolveStorePath(): string {
  const dataDir = process.env.TELECLAW_DATA_DIR ?? path.resolve(process.cwd(), ".teleclaw");
  return process.env.TELECLAW_SESSIONS_STORE_PATH ?? path.join(dataDir, DEFAULT_SESSIONS_FILENAME);
}

async function readStore(config: SessionManagerConfig): Promise<SessionStoreShape> {
  try {
    const raw = await readFile(config.storePath, "utf8");
    const parsed = JSON.parse(raw) as SessionStoreShape;
    return {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch {
    return { sessions: [] };
  }
}

async function writeStore(config: SessionManagerConfig, store: SessionStoreShape): Promise<void> {
  await mkdir(path.dirname(config.storePath), { recursive: true });
  await writeFile(config.storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function createDefaultSession(chatId: string, userId?: string | null): OnCallSessionState {
  const now = nowIso();
  return {
    sessionId: `session:${chatId}`,
    chatId,
    userId: userId ?? null,
    activeProjectId: null,
    workerBinding: {
      workerType: "openhands",
      workerSessionId: null,
      containerId: null,
      containerName: null,
    },
    currentPhase: "idle",
    summary: "",
    durableFacts: [],
    structuredState: {},
    recentActions: [],
    artifactRefs: [],
    pendingApproval: null,
    lastActiveAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function withTouch(session: OnCallSessionState): OnCallSessionState {
  const now = nowIso();
  return {
    ...session,
    lastActiveAt: now,
    updatedAt: now,
  };
}

export function createOnCallSessionManager(
  config: Partial<SessionManagerConfig> = {},
): OnCallSessionManager {
  const resolvedConfig: SessionManagerConfig = {
    storePath: resolveStorePath(),
    ...config,
  };

  return {
    async getOrCreateSession(chatId, userId) {
      const store = await readStore(resolvedConfig);
      const existing = store.sessions.find((session) => session.chatId === chatId);
      if (existing) {
        const touched = withTouch({
          ...existing,
          userId: existing.userId ?? userId ?? null,
        });
        store.sessions = store.sessions.map((session) =>
          session.sessionId === touched.sessionId ? touched : session,
        );
        await writeStore(resolvedConfig, store);
        return touched;
      }

      const created = createDefaultSession(chatId, userId);
      store.sessions.push(created);
      await writeStore(resolvedConfig, store);
      return created;
    },

    async getSessionById(sessionId) {
      const store = await readStore(resolvedConfig);
      return store.sessions.find((session) => session.sessionId === sessionId) ?? null;
    },

    async updateSession(sessionId, mutator) {
      const store = await readStore(resolvedConfig);
      const current = store.sessions.find((session) => session.sessionId === sessionId);
      if (!current) {
        return null;
      }
      const next = withTouch(mutator(current));
      store.sessions = store.sessions.map((session) =>
        session.sessionId === sessionId ? next : session,
      );
      await writeStore(resolvedConfig, store);
      return next;
    },

    async bindProject(sessionId, projectId) {
      return await this.updateSession(sessionId, (session) => ({
        ...session,
        activeProjectId: projectId,
      }));
    },

    async bindWorker(sessionId, workerBinding) {
      return await this.updateSession(sessionId, (session) => ({
        ...session,
        workerBinding: {
          ...session.workerBinding,
          ...workerBinding,
        },
      }));
    },

    async appendRecentAction(sessionId, action) {
      return await this.updateSession(sessionId, (session) => ({
        ...session,
        recentActions: [...session.recentActions.slice(-19), action],
      }));
    },

    async setPhase(sessionId, phase) {
      return await this.updateSession(sessionId, (session) => ({
        ...session,
        currentPhase: phase,
      }));
    },

    async setSummary(sessionId, summary) {
      return await this.updateSession(sessionId, (session) => ({
        ...session,
        summary,
      }));
    },

    async setStructuredState(sessionId, structuredState) {
      return await this.updateSession(sessionId, (session) => ({
        ...session,
        structuredState: {
          ...session.structuredState,
          ...structuredState,
        },
      }));
    },

    async setPendingApproval(sessionId, pendingApproval) {
      return await this.updateSession(sessionId, (session) => ({
        ...session,
        pendingApproval,
      }));
    },
  };
}
