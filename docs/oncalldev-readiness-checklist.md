# OnCallDev readiness checklist

This checklist is the operational baseline for daily TeleClaw use on a local machine.

Container note: this now also applies to `docker compose` runs when using the TeleClaw image path.

## Readiness gaps this milestone closed

- Added a single local readiness command (`pnpm teleclaw:doctor`) to validate env, binaries, and model paths.
- Added a practical smoke command (`pnpm teleclaw:smoke`) that focuses on TeleClaw-critical tests.
- Added a dedicated startup helper command (`pnpm teleclaw:start`) with OnCallDev routing enabled.
- Clarified minimum vs optional env settings in `.env.example`.
- Split operator guidance into setup, readiness, and smoke docs to reduce ambiguity.

## Daily-ready baseline

A local TeleClaw environment is considered ready when all items below are true.

1. `pnpm teleclaw:doctor` has no ❌ failures.
2. `pnpm teleclaw:test` passes.
3. Telegram bot is reachable and can exchange text with TeleClaw.
4. Runtime mode (local or docker) matches your machine setup.
5. OpenHands bridge mode is intentional (`vendor_local` by default).
6. If running in container mode, `OPENHANDS_VENDOR_PATH=/app/vendor/openhands` and Python is available.
7. Voice configuration is intentional:
   - either whisper.cpp + Piper are fully configured
   - or fallback-only mode is expected (`ENABLE_VOICE_REPLIES=0`)

## Startup order for local daily use

1. Load your `.env` values.
2. Verify dependencies:
   - `pnpm teleclaw:doctor`
3. Start TeleClaw:
   - `pnpm teleclaw:start`
4. Verify channel/runtime status:
   - `pnpm openclaw channels status --probe`
5. Run TeleClaw smoke tests:
   - `pnpm teleclaw:smoke`

## Startup order for container daily use

1. Build image:
   - `pnpm teleclaw:docker:build`
2. Start compose service:
   - `pnpm teleclaw:docker:up`
3. Validate from inside container:
   - `docker compose exec openclaw-gateway node --import tsx scripts/teleclaw-doctor.ts`

## TeleClaw-authoritative commands

Use these commands as the primary operational signal for TeleClaw:

- `pnpm teleclaw:doctor`
- `pnpm teleclaw:test`
- `pnpm teleclaw:voice:test`
- `pnpm teleclaw:smoke`

If these pass and Telegram runtime behavior is healthy, TeleClaw is operationally ready for day-to-day use.

## Known non-blocking repo failures

The OpenClaw monorepo can have unrelated failures in areas outside `src/teleclaw/**`.

For daily TeleClaw operation:

- treat failures in TeleClaw tests, TeleClaw startup, Telegram message handling, or TeleClaw voice paths as blockers
- treat unrelated failures in untouched subsystems as separate follow-up work

Do not hide unrelated failures in CI, but do not block local TeleClaw operations on them unless they intersect TeleClaw paths.

## What to run first when something breaks

1. `pnpm teleclaw:doctor`
2. `pnpm teleclaw:smoke`
3. `pnpm openclaw channels status --probe`
4. Re-run the scenario from [OnCallDev smoke test](/oncalldev-smoke-test)
5. Review TeleClaw docs:
   - [OnCallDev local setup](/oncalldev-local-setup)
   - [OnCallDev voice flow](/oncalldev-voice-flow)
   - [OnCallDev worker integration](/oncalldev-worker-integration)
