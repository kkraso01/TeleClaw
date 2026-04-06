# OnCallDev MVP architecture

OnCallDev is a focused TeleClaw product for conversational software development over Telegram.

## Scope

The MVP keeps OpenClaw's gateway, Telegram integration, and normalization pipeline while adding a focused TeleClaw layer under `src/teleclaw`.

## New module boundaries

- `src/teleclaw/intent`: natural-language intent resolution (action, project, reply mode).
- `src/teleclaw/projects`: persistent project registry and safe project resolution.
- `src/teleclaw/sessions`: durable session binding (`chat/session -> active project -> worker context`).
- `src/teleclaw/memory`: event log + rolling summary + structured state + durable facts.
- `src/teleclaw/approvals`: TeleClaw-owned pending approval records and approval status rendering.
- `src/teleclaw/worker/adapter.ts`: OpenHands adapter (`runTask`, `resume`, `getStatus`, `summarize`) with project context payloads.
- `src/teleclaw/voice`: STT/TTS seams kept outside worker runtime.
- `src/teleclaw/router`: enforcing orchestration for intent, session/project binding, policy checks, and worker execution.
- `src/teleclaw/policy`: boundary enforcement for project isolation and execution safety.

## Inbound flow

1. Telegram message enters existing OpenClaw channel pipeline.
2. `dispatchReplyWithBufferedBlockDispatcher` gates to OnCallDev when `ONCALLDEV_ENABLED=1` on Telegram contexts.
3. Router resolves intent and durable session.
4. Router resolves/validates project context and applies policy checks.
5. OpenHands adapter executes work against the selected isolated project context.
6. Session/memory state updates are persisted.
7. Final response returns to Telegram via the existing channel delivery path.

## Configuration

- `ONCALLDEV_ENABLED=1` toggles OnCallDev routing.
- `TELECLAW_DATA_DIR` sets the base state directory for TeleClaw stores.
- `TELECLAW_PROJECTS_STORE_PATH` overrides project registry path.
- `TELECLAW_SESSIONS_STORE_PATH` overrides session store path.
- `PROJECTS_ROOT` sets the default allowed workspace root.
- `ALLOWED_PROJECT_MOUNTS` adds extra comma-separated allowed roots.
- `OPENHANDS_ENDPOINT` targets the OpenHands worker service.
- `ONCALLDEV_OPENHANDS_API_KEY` optional bearer token.
- `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` are forwarded to worker runtime payloads.
- `DEFAULT_REPLY_MODE` can be used by project defaults and reply formatting policy.

## Additional docs

- [Project routing](/oncalldev-project-routing)
- [Session model](/oncalldev-session-model)
- [Memory model](/oncalldev-memory-model)
- [Voice flow](/oncalldev-voice-flow)

## Known MVP TODOs

- Replace file-backed project/session stores with SQLite when migration and deploy footprint are acceptable.
- Replace mock STT/TTS providers with production integrations and media persistence.
- Add explicit project authorization policy per Telegram user.
- Add health probes for OpenHands project containers.
- Expand channel-visible progress updates for long-running worker tasks.

## Runtime lifecycle milestone

The TeleClaw runtime milestone adds backend-controlled runtime/container lifecycle with one project per runtime binding, runtime policy checks, and runtime-aware router enforcement before OpenHands execution.

See [OnCallDev Runtime Model](/oncalldev-runtime-model), [OnCallDev Container Lifecycle](/oncalldev-container-lifecycle), [OnCallDev Docker runtime provider](/oncalldev-docker-provider), and [OnCallDev workspace bootstrap](/oncalldev-workspace-bootstrap).

## Milestone update: bootstrap + repo lifecycle

- Natural-language project creation/bootstrap is now supported.
- TeleClaw stores durable repo status and branch metadata per project.
- TeleClaw stores per-project execution profiles used by worker execution context.
