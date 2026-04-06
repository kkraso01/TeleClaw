# OnCallDev local setup and operator runbook

This runbook is the practical day-to-day setup path for TeleClaw local use.

## 1) Prerequisites

- Node 22+
- `pnpm`
- Telegram bot token
- OpenHands bridge path configured (default is vendored local mode)
- Optional voice binaries:
  - `whisper-cli` from whisper.cpp
  - `piper`

Install dependencies:

```bash
pnpm install
```

## 2) Configure environment once

Start from `.env.example`, then set the minimum local baseline:

```bash
ONCALLDEV_ENABLED=1
TELEGRAM_BOT_TOKEN=123456:ABCDEF...
OPENHANDS_ENABLED=1
OPENHANDS_MODE=vendor_local
TELECLAW_DATA_DIR=~/.openclaw/teleclaw
PROJECTS_ROOT=/workspace
```

Optional but common for runtime/container control:

```bash
CONTAINER_RUNTIME=local
# or docker
# CONTAINER_RUNTIME=docker
# TELECLAW_DOCKER_ENABLED=1
```

Optional voice baseline:

```bash
STT_PROVIDER=whisper.cpp
STT_WHISPERCPP_BIN=whisper-cli
STT_WHISPERCPP_MODEL=./models/ggml-base.en.bin

TTS_PROVIDER=piper
TTS_PIPER_BIN=piper
TTS_PIPER_MODEL=./models/en_US-lessac-medium.onnx
ENABLE_VOICE_REPLIES=1

TTS_OUTPUT_DIR=~/.openclaw/teleclaw/voice
TTS_OUTPUT_TTL_SECONDS=604800
TTS_OUTPUT_MAX_FILES=500
```

## 3) Verify local readiness

Run the readiness helper first:

```bash
pnpm teleclaw:doctor
```

What it checks:

- required env presence
- optional env hints
- `docker`, whisper.cpp, and Piper binary presence
- configured model file paths
- TeleClaw data and voice artifact directories

Fix all ❌ items before relying on TeleClaw for daily use.

## 4) Startup sequence

Use this startup order every time:

1. `pnpm teleclaw:doctor`
2. `pnpm teleclaw:start`
3. `pnpm openclaw channels status --probe`
4. `pnpm teleclaw:smoke`

`teleclaw:start` runs OpenClaw gateway dev mode with `ONCALLDEV_ENABLED=1` to keep startup explicit for TeleClaw operation.

## 5) Daily verification flow

### Core TeleClaw checks

```bash
pnpm teleclaw:test
pnpm teleclaw:voice:test
```

### Optional real local-binary checks

These are intentionally opt-in:

```bash
TELECLAW_RUN_REAL_STT_TESTS=1 pnpm test src/teleclaw/voice/providers/stt-whispercpp.integration.test.ts
TELECLAW_RUN_REAL_TTS_TESTS=1 pnpm test src/teleclaw/voice/providers/tts-piper.integration.test.ts
```

### Telegram manual checks

- Send a text task; confirm a normal execution response.
- Send `status`; confirm runtime/state visibility.
- Send `summarize`; confirm session summary visibility.
- Run one approval-required scenario (`approve` / `reject` / `resume`).
- Send a voice note; confirm transcript or safe fallback behavior.

## 6) Voice artifacts and retention

- Generated voice outputs are written to `TTS_OUTPUT_DIR`.
- Cleanup runs before synthesis.
- Retention policy:
  - remove files older than `TTS_OUTPUT_TTL_SECONDS`
  - keep only newest `TTS_OUTPUT_MAX_FILES`

## 7) Failure diagnosis flow

When behavior is unexpected, run:

```bash
pnpm teleclaw:doctor
pnpm teleclaw:smoke
pnpm openclaw channels status --probe
```

Common diagnostics:

- `Piper TTS requires TTS_PIPER_MODEL to be set.`
  - set `TTS_PIPER_MODEL` and verify file path.
- whisper.cpp provider failure
  - verify `STT_WHISPERCPP_BIN`, `STT_WHISPERCPP_MODEL`, and local binary execution.
- runtime not starting
  - verify `CONTAINER_RUNTIME` and Docker availability when using docker mode.
- OpenHands failure
  - verify `OPENHANDS_MODE`, `OPENHANDS_ENDPOINT`, and vendored path/remote endpoint health.

## 8) TeleClaw blockers vs unrelated repo failures

For day-to-day TeleClaw operation, treat these as authoritative:

- `pnpm teleclaw:doctor`
- `pnpm teleclaw:test`
- `pnpm teleclaw:voice:test`
- [OnCallDev smoke test](/oncalldev-smoke-test)

Treat as TeleClaw blockers:

- failures in `src/teleclaw/**`
- Telegram routing failures for TeleClaw flows
- runtime ensure/validation failures for TeleClaw projects
- approval lifecycle failures

Treat as unrelated for local TeleClaw iteration unless touched by your change:

- failures outside TeleClaw paths
- platform lanes unrelated to Telegram + TeleClaw runtime/voice

Do not suppress unrelated failures in CI; just keep local operator decisions aligned to TeleClaw-scoped checks.

## 9) Companion docs

- [OnCallDev readiness checklist](/oncalldev-readiness-checklist)
- [OnCallDev smoke test](/oncalldev-smoke-test)
- [OnCallDev MVP architecture](/oncalldev-mvp)
- [OnCallDev worker integration](/oncalldev-worker-integration)
- [OnCallDev voice flow](/oncalldev-voice-flow)
