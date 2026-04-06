# OnCallDev session model

OnCallDev keeps one durable conversational session per Telegram chat context.

## Session storage

Session state is stored in a durable JSON file. By default it is written to:

- `${TELECLAW_DATA_DIR}/sessions.json`

You can override this with `TELECLAW_SESSIONS_STORE_PATH`.

Sessions persist across process restarts.

## Session schema

Each session stores:

- identity: `sessionId`, `chatId`, `userId`
- routing: `activeProjectId`
- worker binding: `workerType`, `workerSessionId`, `containerId`
- phase: `idle`, `intake`, `planning`, `implementing`, `testing`, `blocked`, `awaiting_approval`, `reporting`, `paused`
- memory pointers: `summary`, `durableFacts`, `structuredState`, `recentActions`, `artifactRefs`
- approval state: `pendingApproval` (durable pause/resume control record)
- audit timestamps: `lastActiveAt`, `createdAt`, `updatedAt`

## Lifecycle behavior

- `getOrCreateSession(chatId)` returns existing state or initializes a new record.
- Router updates are durable after each routing and worker event:
  - project bind
  - worker bind updates
  - summary and structured-state updates
  - recent action append

This keeps TeleClaw stateful even when the process restarts.

## Session and memory interplay

- Active project is backend-controlled by router resolution.
- User text cannot directly force arbitrary host path routing.
- Worker execution always uses the session-bound project context.
- If no project is selected, router returns a structured non-execution outcome.
- Project switches emit durable memory events for auditability.
- Worker progress updates append recent actions and update structured state.
- Status and summarize requests can be answered from rolling memory summaries without rerunning worker execution.

## Current TODOs

- Add configurable retention controls for long-running sessions.
- Add session ownership and access controls beyond chat-level binding.

## Runtime-aware session bindings

`workerBinding` now persists runtime context fields used by execution routing:

- `workerType`
- `workerSessionId`
- `containerId`
- `containerName`

Session `activeProjectId` remains the canonical project pointer for runtime attach/resume behavior.

## Execution lifecycle state

Session structured state now tracks install/test/build status and latest blocker/summary hints from execution progress.

## Pending approval model

`pendingApproval` is TeleClaw-owned and durable. It stores:

- `approvalId`, `sessionId`, `projectId`
- `originalInstruction`
- normalized action summary and risk reason
- approval classification details
- worker/runtime context snapshots
- lifecycle timestamps and status (`pending`, `approved`, `rejected`, `expired`, `resumed`)
