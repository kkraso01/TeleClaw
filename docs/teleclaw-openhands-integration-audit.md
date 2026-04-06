# TeleClaw to OpenHands Integration Audit

## Scope

This audit covers the vendored OpenHands snapshot under `vendor/openhands` and identifies the safest integration point for TeleClaw worker execution.

## Snapshot observations

- `vendor/openhands/openhands/core/main.py` exposes `run_controller(...)`, and is directly runnable as `python -m openhands.core.main`. The file is explicitly marked legacy V0 and scheduled for removal in OpenHands upstream. That makes it usable for a vendored snapshot but not a long-term stable contract.
- `vendor/openhands/openhands/core/setup.py` contains `create_runtime(...)` and runtime/repository bootstrap helpers. These are internal primitives with broad dependency surfaces.
- `vendor/openhands/openhands/app_server/**` is the newer V1 app-server path but requires broader service orchestration and additional lifecycle assumptions than TeleClaw needs for this milestone.

## Recommended integration point

### Primary recommendation (MVP)

Use the vendored CLI/module execution path:

- process entry: `python -m openhands.core.main`
- invocation ownership: TeleClaw worker adapter (`src/teleclaw/worker/openhands/index.ts`)
- boundary: only TeleClaw worker integration files invoke vendored OpenHands

Why:

- keeps OpenHands usage behind a narrow TeleClaw adapter boundary
- avoids deep imports from many internal OpenHands modules
- minimizes vendored patching
- preserves ability to switch to V1 app-server integration later

## Rejected integration points

1. **Deep direct imports from `openhands.server.*` and `openhands.app_server.*` into TeleClaw modules**
   - rejected due to broad compile/runtime coupling and high churn risk.
2. **Direct use of `create_controller`/`create_runtime` internals from many TeleClaw call sites**
   - rejected due to unstable internal API surface and invasive coupling.
3. **Reimplementing custom TeleClaw dev-loop engine**
   - rejected because OpenHands should own dev execution logic.

## Minimum viable integration path

1. Resolve OpenHands bridge config from TeleClaw env.
2. Route worker calls through `src/teleclaw/worker/adapter.ts`.
3. In vendored mode, spawn `python -m openhands.core.main` with TeleClaw workspace/session context.
4. Normalize output and inferred progress events into TeleClaw worker result/event models.
5. Keep router/session/memory flows unchanged except through the worker adapter contract.

## Upstream version assumptions

- The vendored snapshot appears to include both V0 and V1 code paths.
- Exact upstream tag/commit is unknown from working tree metadata.
- Integration assumes this snapshot remains fixed in this fork unless intentionally updated.

## Known limitations in this milestone

- Resume/status/summarize are mapped into task-style invocations for vendored mode.
- Progress events are inferred from process output patterns, not native OpenHands event streaming.
- This is intentionally an adapter-first MVP boundary and not yet a full V1 app-server wire-up.
