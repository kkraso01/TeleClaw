# OnCallDev Container Lifecycle

This page describes runtime/container lifecycle behavior used by TeleClaw routing.

## Lifecycle states

A project runtime moves across:

1. `unbound`
2. `starting`
3. `running`
4. `stopped`
5. `error`

## Router flow

Before worker execution, the router performs:

1. resolve project
2. policy validation
3. `ensureProjectRuntime`
4. `validateProjectRuntime`
5. session worker binding update (`containerId`, `containerName`, worker session binding)
6. worker call (or runtime-only response for runtime commands)

## Runtime commands from natural language

Without slash commands, router recognizes runtime intents such as:

- "restart the bot project"
- "stop the test project"
- "start the frontend"
- "is the scraper running?"

Runtime-focused requests return runtime-aware status text and skip unnecessary worker calls.

## Runtime events in memory

Runtime lifecycle is persisted in memory as runtime events:

- `runtime.ensure_requested`
- `runtime.inspect_started`
- `runtime.inspect_succeeded`
- `runtime.created`
- `runtime.started`
- `runtime.reused`
- `runtime.stopped`
- `runtime.restarted`
- `runtime.reconciled`
- `runtime.stale`
- `runtime.bootstrap_completed`
- `runtime.bootstrap_failed`
- `runtime.validation_failed`
- `runtime.error`

These events support auditability and follow-up questions like "why didn’t it continue?"

## Current limitations

- Runtime health validation is status-based and does not yet run deep app-level health probes.
- OpenHands backends may not all enforce hard container pinning yet; TeleClaw preserves explicit runtime binding context for the adapter seam.

See [OnCallDev Memory Model](/oncalldev-memory-model) for how lifecycle events are queryable.
