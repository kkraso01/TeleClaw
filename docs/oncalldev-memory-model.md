# OnCallDev memory model

OnCallDev keeps durable memory per TeleClaw session and project so long-running work can survive restarts.

## Storage

Memory is stored as JSON and defaults to:

- `${TELECLAW_DATA_DIR}/memory.json`

Override path with `TELECLAW_MEMORY_STORE_PATH`.

## Memory layers

Each session can keep both session-wide and project-scoped memory slices.

1. Raw event log
   - inbound user text
   - inbound voice message
   - voice transcript
   - resolved intent
   - router decisions
   - project switches
   - worker starts
   - worker progress
   - worker summaries
   - policy blocks
   - outbound replies
   - compaction events

2. Rolling summary
   - human-readable status used for fast `status` and `summarize` responses

3. Structured state
   - `currentGoal`
   - `currentPhase`
   - `activeTask`
   - `filesChanged`
   - `testsPassing`
   - `testsFailing`
   - `blockers`
   - `lastWorkerAction`
   - `nextSuggestedStep`

4. Durable facts
   - reply mode preference
   - preferred project
   - user preferences
   - architecture constraints
   - security constraints
   - accepted decisions

## Compaction behavior

Compaction is currently heuristic and non-LLM.

When compaction runs, TeleClaw:

- keeps durable facts
- keeps structured state
- derives/refreshes summary text from older events
- trims old raw events, keeping a recent event tail
- appends a `compaction` event for auditability

Compaction prioritizes preserving goal, blockers, changes, test state, and next steps.

## Current limitations and TODOs

- Summary generation is rule-based and should move to LLM summarization later.
- Event retention policy is fixed for now; configurable limits are still TODO.
- Memory writes are file-based JSON (MVP), not SQLite yet.

## Runtime lifecycle events

TeleClaw now persists runtime lifecycle events (`runtime.ensure_requested`, `runtime.started`, `runtime.reused`, `runtime.stopped`, `runtime.restarted`, `runtime.validation_failed`, `runtime.error`) in the same durable event model used for routing and worker traces.

## Additional durable events

Memory now persists bootstrap, repo lifecycle, and execution stage events (for example `project.created`, `repo.inspected`, `execution.test_finished`).
