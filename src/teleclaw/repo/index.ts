import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { OnCallProject, OnCallProjectRepoState, OnCallRepoStatus } from "../types.js";

const execFileAsync = promisify(execFile);

export type RepoInspectionResult = {
  gitAvailable: boolean;
  isRepo: boolean;
  branch: string | null;
  status: OnCallRepoStatus;
  dirty: boolean;
  changedFiles: string[];
  changedFileCount: number;
  error?: string;
};

export type RepoChangedFilesState = {
  branch: string | null;
  dirty: boolean;
  changedFiles: string[];
  changedFileCount: number;
};

export type RepoModule = {
  inspectRepo: (project: OnCallProject) => Promise<RepoInspectionResult>;
  getChangedFilesState: (project: OnCallProject) => Promise<RepoChangedFilesState>;
  getRepoStatus: (project: OnCallProject) => Promise<OnCallProjectRepoState>;
  refreshRepoState: (project: OnCallProject) => Promise<OnCallProjectRepoState>;
  cloneRepo: (project: OnCallProject, repoUrl: string) => Promise<OnCallProjectRepoState>;
  initRepo: (project: OnCallProject) => Promise<OnCallProjectRepoState>;
};

async function runGit(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return await execFileAsync("git", args, {
    cwd,
    env: process.env,
  });
}

async function hasGit(): Promise<boolean> {
  if (process.env.TELECLAW_GIT_ENABLED === "0") {
    return false;
  }
  try {
    await runGit(["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function hasGitDir(workspacePath: string): Promise<boolean> {
  try {
    await access(path.join(workspacePath, ".git"));
    return true;
  } catch {
    return false;
  }
}

function parseChangedFiles(statusOutput: string): string[] {
  const files = statusOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[A-Z?]{1,2}\s+/, "").trim())
    .filter(Boolean);
  return [...new Set(files)].toSorted();
}

export async function inspectRepo(project: OnCallProject): Promise<RepoInspectionResult> {
  const workspacePath = path.resolve(project.workspacePath);
  const gitAvailable = await hasGit();
  if (!gitAvailable) {
    return {
      gitAvailable,
      isRepo: false,
      branch: null,
      status: "error",
      dirty: false,
      changedFiles: [],
      changedFileCount: 0,
      error: "git_unavailable",
    };
  }

  const hasRepo = await hasGitDir(workspacePath);
  if (!hasRepo) {
    return {
      gitAvailable,
      isRepo: false,
      branch: null,
      status: "missing",
      dirty: false,
      changedFiles: [],
      changedFileCount: 0,
    };
  }

  try {
    const branchResult = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], workspacePath);
    const branch = branchResult.stdout.trim() || null;
    const statusResult = await runGit(["status", "--porcelain"], workspacePath);
    const changedFiles = parseChangedFiles(statusResult.stdout);
    const dirty = changedFiles.length > 0;
    return {
      gitAvailable,
      isRepo: true,
      branch,
      status: dirty ? "dirty" : "clean",
      dirty,
      changedFiles,
      changedFileCount: changedFiles.length,
    };
  } catch (error) {
    return {
      gitAvailable,
      isRepo: true,
      branch: null,
      status: "error",
      dirty: false,
      changedFiles: [],
      changedFileCount: 0,
      error: error instanceof Error ? error.message : "repo_inspection_failed",
    };
  }
}

function toRepoState(
  project: OnCallProject,
  inspection: RepoInspectionResult,
): OnCallProjectRepoState {
  const now = new Date().toISOString();
  return {
    repoUrl: project.repoUrl,
    repoStatus: inspection.status,
    branch: inspection.branch,
    lastRepoSyncAt: now,
    repoError: inspection.error ?? null,
  };
}

export function createRepoModule(): RepoModule {
  return {
    inspectRepo,

    async getChangedFilesState(project) {
      const inspection = await inspectRepo(project);
      return {
        branch: inspection.branch,
        dirty: inspection.dirty,
        changedFiles: inspection.changedFiles,
        changedFileCount: inspection.changedFileCount,
      };
    },

    async getRepoStatus(project) {
      const inspection = await inspectRepo(project);
      return toRepoState(project, inspection);
    },

    async refreshRepoState(project) {
      const inspection = await inspectRepo(project);
      return toRepoState(project, inspection);
    },

    async cloneRepo(project, repoUrl) {
      const workspacePath = path.resolve(project.workspacePath);
      await runGit(["clone", repoUrl, workspacePath]);
      const inspection = await inspectRepo(project);
      return toRepoState({ ...project, repoUrl }, inspection);
    },

    async initRepo(project) {
      const workspacePath = path.resolve(project.workspacePath);
      await runGit(["init"], workspacePath);
      const inspection = await inspectRepo(project);
      return toRepoState(project, inspection);
    },
  };
}
