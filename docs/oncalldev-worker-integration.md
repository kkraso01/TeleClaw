# OnCallDev worker integration (TeleClaw + vendored OpenHands)

## Current execution path audit (April 6, 2026)

### Router and adapter path today

1. `src/teleclaw/router/index.ts` resolves intent, project, session, and runtime.
2. Router builds `OnCallWorkerContext` and calls the TeleClaw worker adapter.
3. `src/teleclaw/worker/adapter.ts` routes `runTask` / `resume` / `getStatus` / `summarize` into `createOpenHandsBridge(...).run(...)`.
4. `src/teleclaw/worker/openhands/index.ts` decides transport by config mode:
   - `vendor_local` (default): spawn vendored OpenHands Python module.
   - `remote_http`: POST to remote OpenHands HTTP bridge.
   - `disabled`: deterministic disabled response.

### Is vendored OpenHands the default worker backend?

Yes. Config default remains `OPENHANDS_MODE=vendor_local` when `OPENHANDS_ENABLED` is true.

### Ingestion gaps audited before this milestone

- Worker output capture existed (`text`, optional `summary`, sparse `progressEvents`) but lacked a TeleClaw-owned normalized execution state lifecycle.
- Changed files were weakly represented (often empty arrays unless explicit worker structure appeared).
- Install/test/build outcomes were partially heuristic and not consistently persisted in durable session + memory slices.
- Blocker/error/next-step context was often only inferred from freeform summary text.
- Status/summarize answers could over-rely on rolling summaries even when richer structured state could be assembled.

### Target normalized execution state

TeleClaw now normalizes execution into durable, project-aware fields:

- `currentExecutionPhase`: idle, planning, implementing, installing, testing, building, summarizing, blocked, completed, error
- `lastWorkerAction`, `lastTaskInstruction`
- `filesChanged[]`, `filesChangedSummary`
- `installStatus`, `testStatus`, `buildStatus`
- `blockerReason`, `lastErrorSummary`, `nextSuggestedStep`
- `lastExecutionSummary`, `lastExecutionStartedAt`, `lastExecutionFinishedAt`
- `lastKnownBranch`, `lastKnownRepoDirtyState`, `lastKnownChangedFileCount`

### Source of truth split: OpenHands vs TeleClaw inference

Directly sourced from OpenHands when available:

- worker `status`, `text`, `summary`
- structured `progressEvents`
- `workerSessionId`
- optional structured fields on result payloads (phase/status/blocker/files)

TeleClaw inference and normalization:

- bounded phase inference from vendored OpenHands output when structure is missing
- install/test/build status normalization (`started/succeeded/failed`, `passed/failed`)
- blocker/error/next-step extraction from bounded line-pattern heuristics
- repo branch/dirty refresh post-execution for status quality
- durable session/memory synchronization and router-facing summarize/status rendering

## Milestone changes in this repo

### Backend routing and reliability

- Vendored OpenHands stays primary and deterministic (`vendor_local` default).
- Added optional secondary fallback from vendored local mode to remote HTTP mode via `OPENHANDS_REMOTE_FALLBACK_ENABLED` (defaults true).
- Bridge responses now expose clearer metadata when fallback is used (`meta.mode = remote_http_fallback`, fallback source, and vendored error context).

### Result/progress normalization additions

TeleClaw now normalizes and records richer worker progress signals when available or inferred:

- task/resume/planning/implementation phases
- dependency install start + finish
- test start + pass/fail
- build start + finish
- build failure
- worker error signals
- changed file signals
- blocked/completed execution signals

TeleClaw stores this in durable memory and session structured state so status and summarize queries can report:

- what changed
- latest test state
- blocker reason
- next suggested step

### Approval boundaries (TeleClaw-owned)

Before worker execution for task/resume requests, TeleClaw classifies instruction risk:

- `allowed`
- `requires_approval`
- `blocked`

This happens in TeleClaw policy + router layers (not Telegram handler code).

## Known limitations

- Vendored OpenHands CLI output is still parsed heuristically; full upstream OpenHands event streaming is not yet wired.
- File-level changed-file lists still depend on worker structure or conservative text pattern matches and may be incomplete.
- Repo dirty-state capture is intentionally bounded (`git status --porcelain` via TeleClaw repo helpers), not a full VCS event engine.

## Recommended future improvements

1. Add a structured OpenHands event adapter instead of plain stdout inference.
2. Add explicit action-intent extraction from OpenHands plans for stronger pre-execution approval classification.
3. Persist explicit approval tickets with expiry and one-click resume linkage.
4. Strengthen changed-files summary with git diff snapshots scoped to runtime workspace.

## Vendored OpenHands update path

1. Keep OpenHands integration boundary in `src/teleclaw/worker/adapter.ts` and `src/teleclaw/worker/openhands/*`.
2. Avoid broad imports of `vendor/openhands` in other modules.
3. If vendor patching is required, keep it minimal and document in `vendor/openhands/UPSTREAM.md`.
4. Re-run focused TeleClaw worker + router tests after vendor updates.
