# OnCallDev worker integration (TeleClaw + vendored OpenHands)

## Why OpenHands is vendored

TeleClaw uses a local vendored OpenHands snapshot under `vendor/openhands` to keep a one-repo development surface and avoid external submodule coupling for this fork.

## Why this is not a submodule

This fork treats OpenHands as a source snapshot dependency. There is no submodule metadata and no runtime dependency on external git operations.

## Integration boundary

TeleClaw imports or executes vendored OpenHands only from:

- `src/teleclaw/worker/adapter.ts`
- `src/teleclaw/worker/openhands/*`

All other TeleClaw modules consume TeleClaw-owned worker contracts.

## Ownership split

TeleClaw owns:

- routing and intent handling
- project/runtime binding and policy checks
- session and memory durability
- user-facing reply shaping

OpenHands owns:

- agentic implementation loop
- code execution workflow in the workspace

## Current mode matrix

- `OPENHANDS_MODE=vendor_local`: execute vendored OpenHands via local Python module invocation.
- `OPENHANDS_MODE=remote_http`: call OpenHands HTTP endpoints.
- `OPENHANDS_ENABLED=0`: disable integration and return deterministic worker-disabled errors.

## Current limitations

- vendored local mode uses process-level output parsing for progress inference
- resume/status/summarize are normalized into instruction-driven execution in vendored mode
- full native OpenHands event streaming is not wired yet

## Safe vendored snapshot update checklist

1. Replace `vendor/openhands` snapshot intentionally.
2. Update `vendor/openhands/UPSTREAM.md` metadata.
3. Re-run TeleClaw worker adapter tests.
4. Validate `vendor_local` and `remote_http` modes.
5. Keep OpenHands-specific logic constrained to the worker boundary files.
