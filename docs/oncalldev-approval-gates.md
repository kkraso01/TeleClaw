# OnCallDev approval gates

## Purpose

TeleClaw approval gates prevent risky or destructive operations from executing without explicit user intent.

Approval logic is TeleClaw-owned and evaluated before worker execution.

## Decision model

`classifyApprovalNeed(instruction)` returns one of:

- `allowed`
- `requires_approval`
- `blocked`

Each classification includes:

- reason
- matched rule
- risk level (`low` | `medium` | `high`)
- `requiresExplicitApproval`

## Current rule coverage

### blocked

- force reset/destructive repo history operations (for example `git reset --hard`, `git clean -fdx`)
- dangerous shell pipes / disk operations (for example `curl ... | sh`, `dd if=/dev/...`)

### requires_approval

- file/directory deletion intents
- destructive branch operations (`git branch -D`, `git push --force`)
- dependency removals / uninstall operations
- broad workspace or repository cleanup requests

### allowed

- all requests that do not match a risky rule

## Router behavior

When classification returns:

- `allowed`: normal execution continues.
- `requires_approval`: router pauses execution, writes a durable pending approval record onto the session, sets session phase to `awaiting_approval`, persists `approval_requested`, and returns `approval_required` structured outcome.
- `blocked`: router returns `blocked_by_policy`, persists `policy_block`, and does not execute worker.

## Durable state and events

TeleClaw persists:

- `approval_requested` events with approval ID, instruction/rule/risk details, and action summary.
- session-level `pendingApproval` with:
  - `approvalId`
  - `sessionId` / `projectId`
  - `originalInstruction`
  - action summary and risk reason
  - policy classification
  - worker/runtime context snapshots
  - `createdAt` and status (`pending` | `approved` | `rejected` | `expired` | `resumed`)
- approval lifecycle events:
  - `approval_granted`
  - `approval_rejected`
  - `approval_resumed`
  - `approval_missing`
  - `approval_query_answered`
- `policy_block` events for blocked destructive actions.

## Current gap (before this milestone)

- TeleClaw could pause on `approval_required` but had no durable, TeleClaw-owned command path to approve/reject and continue safely.
- Approval responses were not interpreted as first-class intents.
- "What are you waiting for?" could not reliably answer from durable approval state.

## Resume strategy

- TeleClaw resolves natural-language approval/rejection intents in router-level logic.
- On approval, TeleClaw:
  1. marks the pending approval `approved`
  2. re-routes using the stored original instruction with an approval bypass token
  3. performs standard runtime/policy checks again
  4. safely re-executes the action path (MVP behavior)
  5. marks approval `resumed` and persists lifecycle events
- On rejection, TeleClaw marks the request `rejected`, keeps the session blocked for that action, and prevents worker execution.
- On status query, TeleClaw answers from the durable session `pendingApproval` record first.

## Limitations

- Rule matching is currently pattern-based on user instruction text.
- Resume is safe re-execution from stored context, not low-level continuation of worker internals.
- MVP supports one active pending approval per session.
- Worker-internal step-by-step shell plan introspection is not fully surfaced from vendored OpenHands yet.
