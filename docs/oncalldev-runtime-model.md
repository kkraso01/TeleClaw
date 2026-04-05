# OnCallDev Runtime Model

TeleClaw now enforces **one project = one runtime binding**.

## Runtime identity

Each project keeps durable runtime metadata in the project registry:

- `runtimeStatus` (`unbound` | `starting` | `running` | `stopped` | `error`)
- `containerId`
- `containerName`
- `runtimeFamily`
- `workspacePath`
- `lastRuntimeStartAt`
- `lastRuntimeCheckAt`
- `runtimeError`

Runtime metadata is updated by the runtime controller, not by Telegram handlers.

## Runtime controller boundary

Runtime/container lifecycle logic lives in `src/teleclaw/runtime`.

Public API:

- `ensureProjectRuntime(project)`
- `getProjectRuntime(project)`
- `startProjectRuntime(project)`
- `stopProjectRuntime(project)`
- `restartProjectRuntime(project)`
- `validateProjectRuntime(project)`

The router consumes this API and never allows worker execution without a validated runtime.

## Provider seam

TeleClaw uses a runtime provider abstraction so lifecycle behavior can evolve without router refactors.

- Default local provider: in-memory runtime simulation for deterministic tests and local development.
- Docker seam: selected through `CONTAINER_RUNTIME=docker` or `TELECLAW_DOCKER_ENABLED=1`.
- Docker provider now performs real inspect/create/start/stop/restart lifecycle through Docker CLI.
- One project maps to one deterministic container name (`teleclaw-<project-id-slug>`).
- Runtime reconciliation checks durable metadata against real container state after restarts.

## Bootstrap + recovery

Before starting runtime, TeleClaw can bootstrap project workspaces:

- workspace path policy validation
- create missing workspace directories
- detect runtime family from metadata/language/workspace hints
- persist bootstrap + runtime reconciliation metadata durably

See [OnCallDev Docker runtime provider](/oncalldev-docker-provider) and [OnCallDev workspace bootstrap](/oncalldev-workspace-bootstrap).

## Policy and safety

Runtime start/attach is policy-gated:

- workspace path must be under allowed roots
- project mounts must stay in allowed mounts
- archived projects cannot start runtimes
- optional runtime family allowlist can be enforced

See [OnCallDev Project Routing](/oncalldev-project-routing) and [OnCallDev Session Model](/oncalldev-session-model).
