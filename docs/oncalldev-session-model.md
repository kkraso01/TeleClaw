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
- audit timestamps: `lastActiveAt`, `createdAt`, `updatedAt`

## Lifecycle behavior

- `getOrCreateSession(chatId)` returns existing state or initializes a new record.
- Router updates are durable after each routing and worker event:
  - project bind
  - worker bind updates
  - summary and structured-state updates
  - recent action append

This keeps TeleClaw stateful even when the process restarts.

## Session and project interplay

- Active project is backend-controlled by router resolution.
- User text cannot directly force arbitrary host path routing.
- Worker execution always uses the session-bound project context.
- If no project is selected, router returns a structured non-execution outcome.

## Current TODOs

- Add retention controls and compaction for long-running sessions.
- Add optional persistent memory/event store for full transcript recall.
- Add session ownership and access controls beyond chat-level binding.
