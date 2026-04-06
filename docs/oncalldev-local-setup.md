# OnCallDev local setup and operator runbook

This runbook is the day-to-day checklist for running TeleClaw locally with text and voice.

## 1) Prerequisites

- Node 22+
- `pnpm`
- Telegram bot configuration already working for OpenClaw channel routing
- Optional voice binaries:
  - `whisper-cli` from whisper.cpp
  - `piper`

Install dependencies:

```bash
pnpm install
```

## 2) Required local binaries and model files

### whisper.cpp (STT)

Minimum local requirements:

- Binary: `whisper-cli` available on `PATH` or set `STT_WHISPERCPP_BIN`
- Model: GGML model file path in `STT_WHISPERCPP_MODEL`

Quick checks:

```bash
command -v whisper-cli
test -f ./models/ggml-base.en.bin && echo "whisper model ok"
```

### Piper (TTS)

Minimum local requirements:

- Binary: `piper` available on `PATH` or set `TTS_PIPER_BIN`
- Model: ONNX model file path in `TTS_PIPER_MODEL`

Quick checks:

```bash
command -v piper
test -f ./models/en_US-lessac-medium.onnx && echo "piper model ok"
```

## 3) Environment variables

Start from `.env.example`, then set at least:

```bash
ONCALLDEV_ENABLED=1
TELECLAW_DATA_DIR=~/.openclaw/teleclaw

STT_PROVIDER=whisper.cpp
STT_WHISPERCPP_BIN=whisper-cli
STT_WHISPERCPP_MODEL=./models/ggml-base.en.bin
STT_WHISPERCPP_THREADS=4
STT_PROVIDER_TIMEOUT_MS=60000

TTS_PROVIDER=piper
TTS_PIPER_BIN=piper
TTS_PIPER_MODEL=./models/en_US-lessac-medium.onnx
TTS_OUTPUT_DIR=~/.openclaw/teleclaw/voice
TTS_OUTPUT_TTL_SECONDS=604800
TTS_OUTPUT_MAX_FILES=500
TTS_PROVIDER_TIMEOUT_MS=30000
ENABLE_VOICE_REPLIES=1
```

Optional real-binary test flags (off by default):

```bash
TELECLAW_RUN_REAL_STT_TESTS=1
TELECLAW_RUN_REAL_TTS_TESTS=1
```

## 4) Startup order

1. Start OpenHands worker service (if using external endpoint).
2. Ensure TeleClaw env is loaded.
3. Start OpenClaw gateway in dev mode.
4. Confirm Telegram channel connectivity.

Recommended diagnostics:

```bash
pnpm openclaw channels status --probe
pnpm openclaw config get ONCALLDEV_ENABLED
```

## 5) Verification flow

### A. Verify TeleClaw text path

```bash
pnpm teleclaw:test
```

### B. Verify whisper.cpp STT path (deterministic tests)

```bash
pnpm test src/teleclaw/voice/providers/stt-whispercpp.test.ts
```

### C. Verify Piper TTS path (deterministic tests)

```bash
pnpm test src/teleclaw/voice/providers/tts-piper.test.ts
```

### D. Optional real local binary verification

These are skipped unless explicitly enabled.

```bash
TELECLAW_RUN_REAL_STT_TESTS=1 pnpm test src/teleclaw/voice/providers/stt-whispercpp.integration.test.ts
TELECLAW_RUN_REAL_TTS_TESTS=1 pnpm test src/teleclaw/voice/providers/tts-piper.integration.test.ts
```

If binaries/models are missing, tests skip with explicit reasons.

### E. Telegram end-to-end flow check

- Send a text message to bot and confirm execution reply.
- Send a voice note and confirm either:
  - transcript + execution reply, or
  - clean text fallback prompt if STT confidence/availability is low.
- If voice replies are enabled, confirm outbound `.wav` reply delivery; otherwise expect text fallback.

## 6) Voice artifact storage and cleanup

- Generated Piper files are written to `TTS_OUTPUT_DIR`.
- Cleanup runs before each new Piper synthesis.
- Retention policy:
  - delete files older than `TTS_OUTPUT_TTL_SECONDS`
  - then enforce at most `TTS_OUTPUT_MAX_FILES` newest files
- Cleanup logs deleted filenames via TeleClaw voice logs.

## 7) Common failure modes and diagnostics

- `Piper TTS requires TTS_PIPER_MODEL to be set.`
  - Set `TTS_PIPER_MODEL` and verify file exists.
- `whisper.cpp` provider failure in transcript metadata
  - Check `STT_WHISPERCPP_BIN`, `STT_WHISPERCPP_MODEL`, and local execution (`command -v whisper-cli`).
- Voice reply fallback to text
  - Confirm `ENABLE_VOICE_REPLIES=1` and Piper configuration.
- Empty or low-quality transcript
  - Validate audio input quality and whisper model/language alignment.

## 8) Scoped TeleClaw commands vs unrelated repo failures

Use these for day-to-day TeleClaw operation:

```bash
pnpm teleclaw:test
pnpm teleclaw:voice:test
pnpm test src/teleclaw/router/e2e-flows.test.ts
```

These commands validate TeleClaw surfaces even if unrelated repo-wide failures exist elsewhere.

Treat as TeleClaw blockers:

- failing tests under `src/teleclaw/**`
- failing Telegram routing/voice flow behavior in TeleClaw e2e scenarios

Treat as unrelated (for TeleClaw local iteration) unless your change touched them:

- failures outside `src/teleclaw/**`
- platform-specific lanes unrelated to Telegram/voice runtime

Do not hide unrelated failures in CI; use scoped commands only for local iteration speed.
