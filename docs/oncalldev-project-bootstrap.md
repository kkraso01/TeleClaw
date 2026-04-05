# OnCallDev project bootstrap

TeleClaw now supports explicit project creation and bootstrap workflows.

## Supported flows

- Create a project from natural language (example: `create a new python project called billing api`).
- Bootstrap an existing project workspace (example: `bootstrap billing`).
- Optionally clone a repo during bootstrap.
- Optionally initialize a git repo when the workspace has no `.git` folder.

## Stored project bootstrap state

Each project stores durable bootstrap metadata:

- `bootstrapStatus`: `uninitialized` | `bootstrapping` | `ready` | `error`
- `bootstrapError`
- `repoUrl`
- `repoStatus`
- `branch`
- `lastRepoSyncAt`
- `repoError`

## Safety boundaries

- Project creation validates workspace names and allowed workspace roots.
- Archived projects are blocked from bootstrap/execution.
- Repo URL validation is format-based today (allowlist TODO).

## Current limitations

- Repo URL host allowlists are TODO.
- Clone/pull/fetch are intentionally narrow and not exposed as arbitrary git command passthrough.
