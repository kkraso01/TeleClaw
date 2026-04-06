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
- `requires_approval`: router pauses execution, sets session phase to `awaiting_approval`, persists `approval_requested` memory event, and returns `approval_required` structured outcome.
- `blocked`: router returns `blocked_by_policy`, persists `policy_block`, and does not execute worker.

## Durable state and events

TeleClaw persists:

- `approval_requested` events with instruction/rule/risk details.
- `policy_block` events for blocked destructive actions.

Planned follow-up:

- explicit `approval_decision` events via user approval command handling.
- resume-after-approval execution replay linked to the paused request.

## Limitations

- Rule matching is currently pattern-based on user instruction text.
- Worker-internal step-by-step shell plan introspection is not fully surfaced from vendored OpenHands yet.
- Some risky actions may only become visible after OpenHands planning output; those are future coverage targets.
