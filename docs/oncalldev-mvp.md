# OnCallDev MVP architecture

OnCallDev is a focused TeleClaw product for conversational software development over Telegram.

## Scope

The MVP keeps OpenClaw's gateway, Telegram integration, and normalization pipeline while adding a focused TeleClaw layer under `src/teleclaw`.

## New module boundaries

- `src/teleclaw/intent`: natural-language intent resolution (action, project, reply mode).
- `src/teleclaw/projects`: project lookup and one-project-per-container mapping.
- `src/teleclaw/sessions`: session state binding (`session -> project`).
- `src/teleclaw/memory`: event log + rolling summary + structured state + durable facts.
- `src/teleclaw/worker/adapter.ts`: OpenHands adapter (`runTask`, `resume`, `getStatus`, `summarize`).
- `src/teleclaw/voice`: STT/TTS seams kept outside worker runtime.
- `src/teleclaw/router`: core request flow orchestration.
- `src/teleclaw/policy`: boundary enforcement for project isolation.

## Inbound flow

1. Telegram message enters existing OpenClaw channel pipeline.
2. `dispatchReplyWithBufferedBlockDispatcher` gates to OnCallDev when `ONCALLDEV_ENABLED=1` on Telegram contexts.
3. Router resolves intent, project, session, and policy.
4. OpenHands adapter executes work against the selected isolated project.
5. Memory state appends raw events and updates summary on summarize operations.
6. Final response returns to Telegram via the existing channel delivery path.

## Configuration

- `ONCALLDEV_ENABLED=1` toggles OnCallDev routing.
- `ONCALLDEV_PROJECTS_JSON` sets project registry and isolation mapping.
- `ONCALLDEV_DEFAULT_PROJECT_ID` selects fallback project.
- `ONCALLDEV_OPENHANDS_BASE_URL` targets the OpenHands worker service.
- `ONCALLDEV_OPENHANDS_API_KEY` optional bearer token.
- `ONCALLDEV_OPENAI_BASE_URL` custom OpenAI-compatible endpoint passed through the worker adapter.
- `ONCALLDEV_MODEL` model hint passed through the worker adapter.

## Known MVP TODOs

- Replace in-memory session and memory stores with persistent storage.
- Implement real Telegram voice-note STT and optional TTS output wiring.
- Add explicit project authorization policy per Telegram user.
- Add health probes for OpenHands project containers.
- Add channel-visible progress updates for long-running worker tasks.
