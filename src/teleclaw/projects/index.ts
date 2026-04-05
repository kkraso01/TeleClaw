import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OnCallProject } from "../types.js";

const DEFAULT_PROJECTS_FILENAME = "projects.json";

type ProjectsStoreShape = {
  projects: OnCallProject[];
  lastActiveByChatId: Record<string, string>;
};

export type OnCallProjectResolution =
  | { type: "resolved"; project: OnCallProject; via: "id" | "name" | "alias" | "recent" | "single" }
  | { type: "ambiguous"; candidates: OnCallProject[] }
  | { type: "not_found" };

export type OnCallProjectCreateInput = Omit<
  OnCallProject,
  "createdAt" | "updatedAt" | "aliases"
> & {
  aliases?: string[];
};

export type OnCallProjectRegistry = {
  listProjects: () => Promise<OnCallProject[]>;
  getProjectById: (projectId: string) => Promise<OnCallProject | null>;
  createProject: (project: OnCallProjectCreateInput) => Promise<OnCallProject>;
  resolveProject: (params: {
    projectRef?: string;
    chatId: string;
  }) => Promise<OnCallProjectResolution>;
  rememberActiveProject: (chatId: string, projectId: string) => Promise<void>;
};

type OnCallProjectRegistryConfig = {
  storePath: string;
  projectsRoot: string;
  additionalAllowedRoots: string[];
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeRef(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function dedupe(values: string[]): string[] {
  const next = new Set<string>();
  for (const value of values) {
    if (value) {
      next.add(value);
    }
  }
  return [...next];
}

function parseListFromEnv(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveStorePath(): string {
  const dataDir = process.env.TELECLAW_DATA_DIR ?? path.resolve(process.cwd(), ".teleclaw");
  return process.env.TELECLAW_PROJECTS_STORE_PATH ?? path.join(dataDir, DEFAULT_PROJECTS_FILENAME);
}

function resolveConfig(): OnCallProjectRegistryConfig {
  const projectsRoot = path.resolve(
    process.env.PROJECTS_ROOT ?? path.resolve(process.cwd(), "workspace"),
  );
  const allowedFromEnv = parseListFromEnv(process.env.ALLOWED_PROJECT_MOUNTS).map((entry) =>
    path.resolve(entry),
  );
  return {
    storePath: resolveStorePath(),
    projectsRoot,
    additionalAllowedRoots: dedupe(allowedFromEnv),
  };
}

function isPathWithinRoot(workspacePath: string, root: string): boolean {
  const rel = path.relative(root, workspacePath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function assertWorkspacePathAllowed(
  workspacePath: string,
  config: OnCallProjectRegistryConfig,
): string {
  const resolved = path.resolve(workspacePath);
  const allowedRoots = dedupe([config.projectsRoot, ...config.additionalAllowedRoots]);
  if (!allowedRoots.some((root) => isPathWithinRoot(resolved, root))) {
    throw new Error(`workspace path must be under allowed roots: ${resolved}`);
  }
  return resolved;
}

async function readStore(config: OnCallProjectRegistryConfig): Promise<ProjectsStoreShape> {
  try {
    const raw = await readFile(config.storePath, "utf8");
    const parsed = JSON.parse(raw) as ProjectsStoreShape;
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      lastActiveByChatId:
        parsed.lastActiveByChatId && typeof parsed.lastActiveByChatId === "object"
          ? parsed.lastActiveByChatId
          : {},
    };
  } catch {
    return { projects: [], lastActiveByChatId: {} };
  }
}

async function writeStore(
  config: OnCallProjectRegistryConfig,
  store: ProjectsStoreShape,
): Promise<void> {
  await mkdir(path.dirname(config.storePath), { recursive: true });
  await writeFile(config.storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function normalizeProject(project: OnCallProject): OnCallProject {
  return {
    ...project,
    aliases: dedupe((project.aliases ?? []).map(normalizeRef)),
    workspacePath: path.resolve(project.workspacePath),
    updatedAt: project.updatedAt ?? nowIso(),
    createdAt: project.createdAt ?? nowIso(),
  };
}

export function createOnCallProjectRegistry(
  config: Partial<OnCallProjectRegistryConfig> = {},
): OnCallProjectRegistry {
  const resolvedConfig = {
    ...resolveConfig(),
    ...config,
  };

  return {
    async listProjects() {
      const store = await readStore(resolvedConfig);
      return store.projects.map(normalizeProject);
    },

    async getProjectById(projectId) {
      const projects = await this.listProjects();
      const match = projects.find(
        (project) => normalizeRef(project.id) === normalizeRef(projectId),
      );
      return match ?? null;
    },

    async createProject(input) {
      const store = await readStore(resolvedConfig);
      const id = normalizeRef(input.id);
      const now = nowIso();
      const workspacePath = assertWorkspacePathAllowed(input.workspacePath, resolvedConfig);
      const project: OnCallProject = {
        ...input,
        id,
        name: input.name.trim(),
        aliases: dedupe([...(input.aliases ?? []), input.name, id].map(normalizeRef)),
        workspacePath,
        createdAt: now,
        updatedAt: now,
      };
      const existing = store.projects.find((candidate) => normalizeRef(candidate.id) === id);
      if (existing) {
        throw new Error(`project already exists: ${id}`);
      }
      store.projects.push(project);
      await writeStore(resolvedConfig, store);
      return project;
    },

    async resolveProject({ projectRef, chatId }) {
      const store = await readStore(resolvedConfig);
      const projects = store.projects.map(normalizeProject);
      if (projects.length === 0) {
        return { type: "not_found" };
      }

      const normalizedRef = projectRef ? normalizeRef(projectRef) : undefined;
      if (normalizedRef) {
        const exactMatches = projects.filter((project) => {
          if (normalizeRef(project.id) === normalizedRef) {
            return true;
          }
          if (normalizeRef(project.name) === normalizedRef) {
            return true;
          }
          return project.aliases.map(normalizeRef).includes(normalizedRef);
        });

        if (exactMatches.length === 1) {
          const matched = exactMatches[0];
          const via =
            normalizeRef(matched.id) === normalizedRef
              ? "id"
              : normalizeRef(matched.name) === normalizedRef
                ? "name"
                : "alias";
          return { type: "resolved", project: matched, via };
        }

        if (exactMatches.length > 1) {
          return { type: "ambiguous", candidates: exactMatches };
        }

        const fuzzyCandidates = projects.filter((project) => {
          const fields = [project.id, project.name, ...project.aliases].map(normalizeRef);
          return fields.some((field) => field.startsWith(normalizedRef));
        });
        if (fuzzyCandidates.length === 1) {
          return { type: "resolved", project: fuzzyCandidates[0], via: "alias" };
        }
        if (fuzzyCandidates.length > 1) {
          return { type: "ambiguous", candidates: fuzzyCandidates };
        }

        return { type: "not_found" };
      }

      const recentProjectId = store.lastActiveByChatId[chatId];
      if (recentProjectId) {
        const recent = projects.find(
          (project) => normalizeRef(project.id) === normalizeRef(recentProjectId),
        );
        if (recent) {
          return { type: "resolved", project: recent, via: "recent" };
        }
      }

      if (projects.length === 1) {
        return { type: "resolved", project: projects[0], via: "single" };
      }

      return { type: "ambiguous", candidates: projects };
    },

    async rememberActiveProject(chatId, projectId) {
      const store = await readStore(resolvedConfig);
      store.lastActiveByChatId[chatId] = projectId;
      await writeStore(resolvedConfig, store);
    },
  };
}

export { assertWorkspacePathAllowed, normalizeRef as normalizeProjectRef };
