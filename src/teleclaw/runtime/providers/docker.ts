import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { OnCallProject } from "../../types.js";
import type {
  OnCallRuntimeBindingResult,
  OnCallRuntimeProvider,
  OnCallRuntimeState,
  OnCallRuntimeValidationResult,
} from "../index.js";
import { buildDeterministicContainerName, inferRuntimeFamily } from "./local.js";

const execFileAsync = promisify(execFile);

type DockerProviderConfig = {
  network: string;
  imagePython: string;
  imageNode: string;
  imageGeneric: string;
  dockerBin: string;
  runCommand: (args: string[]) => Promise<string>;
};

type DockerInspect = {
  Id?: string;
  Name?: string;
  Config?: { Image?: string };
  State?: {
    Status?: string;
    Running?: boolean;
    Error?: string;
  };
};

function nowIso() {
  return new Date().toISOString();
}

function resolveDockerConfig(partial: Partial<DockerProviderConfig> = {}): DockerProviderConfig {
  const dockerBin = partial.dockerBin ?? "docker";
  const runCommand =
    partial.runCommand ??
    (async (args: string[]) => {
      const result = await execFileAsync(dockerBin, args, {
        encoding: "utf8",
        timeout: 12_000,
      });
      return result.stdout.trim();
    });

  return {
    network: process.env.TELECLAW_DOCKER_NETWORK ?? "bridge",
    imagePython: process.env.TELECLAW_DOCKER_IMAGE_PYTHON ?? "python:3.12-slim",
    imageNode: process.env.TELECLAW_DOCKER_IMAGE_NODE ?? "node:22-bookworm-slim",
    imageGeneric: process.env.TELECLAW_DOCKER_IMAGE_GENERIC ?? "ubuntu:24.04",
    dockerBin,
    runCommand,
    ...partial,
  };
}

function selectImage(runtimeFamily: string, config: DockerProviderConfig): string {
  if (runtimeFamily === "python") {
    return config.imagePython;
  }
  if (runtimeFamily === "node") {
    return config.imageNode;
  }
  return config.imageGeneric;
}

function toState(params: {
  project: OnCallProject;
  inspect: DockerInspect | null;
  runtimeFamily: string;
  error?: string;
}): OnCallRuntimeState {
  const inspectedName = params.inspect?.Name?.replace(/^\//, "") ?? null;
  const running = params.inspect?.State?.Running === true;
  const status = params.error
    ? "error"
    : params.inspect
      ? running
        ? "running"
        : "stopped"
      : "unbound";

  return {
    status,
    containerId: params.inspect?.Id ?? null,
    containerName: inspectedName ?? buildDeterministicContainerName(params.project.id),
    runtimeFamily: params.runtimeFamily,
    workspacePath: path.resolve(params.project.workspacePath),
    checkedAt: nowIso(),
    error: params.error ?? params.inspect?.State?.Error ?? undefined,
  };
}

async function inspectContainer(
  project: OnCallProject,
  cfg: DockerProviderConfig,
): Promise<DockerInspect | null> {
  const candidates = [
    project.containerId,
    project.containerName,
    buildDeterministicContainerName(project.id),
  ].filter(
    (value, index, list): value is string => Boolean(value) && list.indexOf(value) === index,
  );

  for (const candidate of candidates) {
    try {
      const output = await cfg.runCommand(["inspect", candidate, "--format", "{{json .}}"]);
      if (!output) {
        continue;
      }
      return JSON.parse(output) as DockerInspect;
    } catch {
      continue;
    }
  }

  return null;
}

async function createContainer(project: OnCallProject, cfg: DockerProviderConfig): Promise<void> {
  const runtimeFamily = inferRuntimeFamily(project);
  const image = selectImage(runtimeFamily, cfg);
  const containerName = buildDeterministicContainerName(project.id);
  const workspacePath = path.resolve(project.workspacePath);

  await cfg.runCommand([
    "create",
    "--name",
    containerName,
    "--label",
    `teleclaw.project.id=${project.id}`,
    "--network",
    cfg.network,
    "-v",
    `${workspacePath}:/workspace`,
    "-w",
    "/workspace",
    "-d",
    image,
    "sleep",
    "infinity",
  ]);
}

export function createDockerRuntimeProvider(
  partial: Partial<DockerProviderConfig> = {},
): OnCallRuntimeProvider {
  const cfg = resolveDockerConfig(partial);

  async function ensureContainerRunning(
    project: OnCallProject,
  ): Promise<OnCallRuntimeBindingResult> {
    const runtimeFamily = inferRuntimeFamily(project);
    let inspect = await inspectContainer(project, cfg);

    if (!inspect) {
      await createContainer(project, cfg);
      inspect = await inspectContainer(project, cfg);
      if (!inspect?.Id) {
        throw new Error("container_create_failed");
      }
      await cfg.runCommand(["start", inspect.Id]);
      const startedInspect = await inspectContainer(project, cfg);
      return {
        outcome: "runtime_started",
        status: toState({
          project,
          inspect: startedInspect,
          runtimeFamily,
        }),
      };
    }

    if (inspect.State?.Running) {
      return {
        outcome: "runtime_reused",
        status: toState({ project, inspect, runtimeFamily }),
      };
    }

    await cfg.runCommand(["start", inspect.Id ?? buildDeterministicContainerName(project.id)]);
    const startedInspect = await inspectContainer(project, cfg);
    return {
      outcome: "runtime_started",
      status: toState({
        project,
        inspect: startedInspect,
        runtimeFamily,
      }),
    };
  }

  return {
    async ensure(project) {
      return await ensureContainerRunning(project);
    },

    async inspect(project) {
      const runtimeFamily = inferRuntimeFamily(project);
      try {
        const inspect = await inspectContainer(project, cfg);
        if (!inspect) {
          return toState({
            project,
            inspect: null,
            runtimeFamily,
            error: "container_not_found",
          });
        }
        return toState({ project, inspect, runtimeFamily });
      } catch (error) {
        return toState({
          project,
          inspect: null,
          runtimeFamily,
          error: error instanceof Error ? error.message : "docker_inspect_failed",
        });
      }
    },

    async getStatus(project) {
      return await this.inspect(project);
    },

    async start(project) {
      const result = await ensureContainerRunning(project);
      return result.status;
    },

    async stop(project) {
      const runtimeFamily = inferRuntimeFamily(project);
      const inspect = await inspectContainer(project, cfg);
      if (!inspect?.Id) {
        return toState({
          project,
          inspect: null,
          runtimeFamily,
          error: "container_not_found",
        });
      }
      await cfg.runCommand(["stop", inspect.Id]);
      const updated = await inspectContainer(project, cfg);
      return toState({ project, inspect: updated, runtimeFamily });
    },

    async restart(project) {
      const runtimeFamily = inferRuntimeFamily(project);
      const inspect = await inspectContainer(project, cfg);
      if (!inspect?.Id) {
        const started = await ensureContainerRunning(project);
        return started.status;
      }
      await cfg.runCommand(["restart", inspect.Id]);
      const updated = await inspectContainer(project, cfg);
      return toState({ project, inspect: updated, runtimeFamily });
    },

    async validate(project): Promise<OnCallRuntimeValidationResult> {
      const status = await this.inspect(project);
      if (status.status === "running" && status.containerId) {
        return { ok: true, status };
      }
      return {
        ok: false,
        status,
        reason: status.error ?? "runtime_not_running",
      };
    },
  };
}

export { buildDeterministicContainerName, inferRuntimeFamily, selectImage };
