import type { OnCallProject } from "../types.js";

export type OnCallProjectResolver = {
  resolveByReference: (projectRef: string | undefined, userId: string) => OnCallProject | null;
};

const defaultProject = process.env.ONCALLDEV_DEFAULT_PROJECT_ID ?? "default";

function parseProjectsFromEnv(): OnCallProject[] {
  const serialized = process.env.ONCALLDEV_PROJECTS_JSON;
  if (!serialized) {
    return [
      {
        id: defaultProject,
        aliases: ["default"],
        workspaceRoot: "/workspace/default",
        containerId: `oncalldev-${defaultProject}`,
      },
    ];
  }

  try {
    const parsed = JSON.parse(serialized) as OnCallProject[];
    return parsed.filter((project) => Boolean(project.id && project.workspaceRoot));
  } catch {
    return [];
  }
}

export function createOnCallProjectResolver(
  projects = parseProjectsFromEnv(),
): OnCallProjectResolver {
  const byId = new Map<string, OnCallProject>();
  for (const project of projects) {
    byId.set(project.id.toLowerCase(), project);
    for (const alias of project.aliases ?? []) {
      byId.set(alias.toLowerCase(), project);
    }
  }

  const fallback = byId.get(defaultProject.toLowerCase()) ?? projects[0] ?? null;

  return {
    resolveByReference(projectRef) {
      if (!projectRef) {
        return fallback;
      }
      return byId.get(projectRef.toLowerCase()) ?? fallback;
    },
  };
}
