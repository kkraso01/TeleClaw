# OnCallDev smoke test

This is the fastest practical smoke checklist for TeleClaw daily operation.

## 0) Preconditions

- `.env` is configured from `.env.example`
- Telegram bot token is set
- OpenHands mode/endpoint is set as intended
- If voice coverage is required, whisper.cpp and Piper binaries/models are present

## 1) Boot and readiness checks

Run in this order:

```bash
pnpm teleclaw:doctor
pnpm teleclaw:start
pnpm openclaw channels status --probe
```

Expected:

- `teleclaw:doctor` has no ❌
- gateway starts successfully
- Telegram channel probe is healthy

### Container variant

```bash
pnpm teleclaw:docker:build
pnpm teleclaw:docker:up
docker compose exec openclaw-gateway node --import tsx scripts/teleclaw-doctor.ts
```

Expected:

- doctor confirms vendored OpenHands path and Python availability
- OpenHands mode stays `vendor_local` unless intentionally changed

## 2) TeleClaw regression smoke

```bash
pnpm teleclaw:smoke
```

This runs:

- `pnpm teleclaw:doctor`
- `pnpm teleclaw:test`
- `pnpm teleclaw:voice:test`

## 3) Manual Telegram text path

In Telegram:

1. send a normal task message to the bot
2. confirm reply references correct project/session behavior
3. ask for `status`
4. ask for `summarize`

Expected:

- message routes to TeleClaw
- project resolution is stable
- runtime ensure/start path succeeds
- status and summarize respond with useful state

## 4) Approval-required flow

Use a task that requests approval.

Expected:

1. TeleClaw returns an approval-required prompt
2. `approve` resumes execution
3. `reject` cancels as expected
4. `resume` continues a paused run when valid

## 5) Voice path checks

### STT

- Send a voice note.
- Confirm transcript is generated with whisper.cpp, or safe text fallback is used when STT is unavailable/low-confidence.

### TTS

- If `ENABLE_VOICE_REPLIES=1` and Piper is configured, confirm `.wav` voice reply is produced.
- If Piper is unavailable, confirm clean text fallback messaging appears.

## 6) Artifact retention sanity

Confirm voice artifact behavior:

- output path uses `TTS_OUTPUT_DIR`
- old files are pruned by `TTS_OUTPUT_TTL_SECONDS`
- file count is capped by `TTS_OUTPUT_MAX_FILES`

## 7) When smoke fails

Run:

```bash
pnpm teleclaw:doctor
pnpm teleclaw:test
pnpm teleclaw:voice:test
```

Then classify:

- **TeleClaw blocker**: failures under `src/teleclaw/**`, Telegram routing failures, runtime ensure failures, approval lifecycle failures.
- **Unrelated repo issue**: failures in untouched systems outside TeleClaw scope.

Keep TeleClaw readiness decisions anchored to the TeleClaw-scoped checks above.
