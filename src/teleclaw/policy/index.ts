import type { OnCallProject, OnCallSessionState } from "../types.js";

export function assertOnCallProjectBoundary(params: {
  session: OnCallSessionState;
  project: OnCallProject;
}): void {
  const { project, session } = params;
  if (session.projectId !== project.id) {
    // Routing layer is the enforcement point for project isolation.
    throw new Error(
      `project boundary violation: session=${session.projectId} project=${project.id}`,
    );
  }
}
