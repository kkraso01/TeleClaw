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

### Remaining bridge gaps identified in this milestone

- Progress normalization was previously mostly heuristic and sparse.
- Worker result normalization lacked first-class phase/blocker/next-step fields.
- Status/summarize responses could rely on rolling summary text without surfacing structured worker facts (tests/files/blockers).
- Approval boundaries for destructive work were not enforced before worker execution.
- Vendor-local failures did not have a clear secondary fallback path in bridge mode.

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
- worker error signals

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

- Vendored OpenHands CLI output is still parsed heuristically; full upstream event streaming is not yet wired.
- File-level changed-file lists are not always available from vendored output and may remain empty unless explicit events/structured payloads are returned.
- Approval pause/resume acknowledgement loop is partially implemented (request + pause are implemented; explicit approval command parsing and replay is a follow-up).

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
