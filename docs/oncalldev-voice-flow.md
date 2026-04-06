# OnCallDev voice flow

OnCallDev supports Telegram voice-note intake by normalizing voice into text before routing.

## Milestone audit summary

### Current provider seam

`src/teleclaw/voice/index.ts` owns a provider seam with two stable operations:

- `transcribeAudio({ audioUrl, transcriptHint? })`
- `synthesizeSpeech(text, options?)`

TeleClaw owns provider selection, transcript normalization, fallback behavior, and memory/session eventing. Provider modules own only STT/TTS inference and artifact creation.

### Previous state before this milestone

- STT default was `faster-whisper` via Python (`STT_PYTHON_BIN`) and inline Python execution.
- TTS default path used `openai` when configured (`TTS_API_KEY`).
- Text fallback existed and remained reliable for missing transcription and synthesis failures.

### Local/open target state after this milestone

- STT default provider: `whisper.cpp`
- TTS default provider: `piper`
- Cloud provider path (`openai` TTS) remains optional and non-default for compatibility.

## Operational flow

1. Telegram voice note reaches `processVoiceInbound` in TeleClaw router.
2. Router persists `inbound_voice_message`.
3. TeleClaw voice service selects STT provider (default `whisper.cpp`).
4. STT provider returns a structured transcript payload:
   - `text`
   - `provider`
   - `metadata.language`
   - `metadata.durationSeconds` (when available)
   - `metadata.segmentCount`
   - `metadata.confidence` (derived/inferred when available)
   - `metadata.quality`
5. Router persists `inbound_voice_transcript`.
6. Transcript flows through the same TeleClaw routing logic as text.
7. If reply mode is `voice` and voice replies are enabled, TeleClaw attempts `piper` synthesis.
8. If synthesis fails or is unavailable, TeleClaw sends text and persists fallback reasons.

## STT provider: whisper.cpp

Default env surface:

- `STT_PROVIDER=whisper.cpp`
- `STT_WHISPERCPP_BIN=whisper-cli`
- `STT_WHISPERCPP_MODEL=<path-to-ggml-model-bin>`
- `STT_WHISPERCPP_LANGUAGE=` (optional)
- `STT_WHISPERCPP_THREADS=4`
- `STT_MIN_CONFIDENCE=0.35`
- `STT_PROVIDER_TIMEOUT_MS=60000`

Notes:

- Local file paths and `file://` paths are supported directly.
- HTTP(S) URLs are downloaded to temporary local files before transcription.
- The core STT runtime path does not require cloud APIs.

## TTS provider: Piper

Default env surface:

- `TTS_PROVIDER=piper`
- `TTS_PIPER_BIN=piper`
- `TTS_PIPER_MODEL=<path-to-piper-onnx-model>`
- `TTS_PIPER_VOICE=` (optional speaker id)
- `TTS_OUTPUT_DIR=~/.openclaw/teleclaw/voice`
- `TTS_PROVIDER_TIMEOUT_MS=30000`
- `ENABLE_VOICE_REPLIES=0` (must be enabled explicitly)

Notes:

- Piper outputs `.wav` artifacts for Telegram delivery.
- Artifacts are stored in `TTS_OUTPUT_DIR` until manually cleaned up.
- If Piper is missing or misconfigured, TeleClaw falls back to text.

## Exact fallback behavior

TeleClaw stays first-class for text under all failure modes.

- STT unavailable/misconfigured/not supported:
  - returns a clear text instruction to retry or send text
  - no execution starts on missing/weak transcript
- STT weak transcript:
  - returns clarification reply
  - persists provider + metadata for debugging
- TTS disabled/unavailable/misconfigured/failed:
  - sends final reply as text
  - includes concise fallback note
  - persists `outbound_voice_reply_failed` and `outbound_voice_reply_fallback_text`

## Limitations after this milestone

- `whisper.cpp` and Piper binaries/models must be installed locally and configured.
- Whisper confidence remains an inferred heuristic from provider output signals.
- Voice output retention is currently file-based; no automatic TTL cleanup is enforced yet.
- OpenAI TTS is still available as a non-default compatibility option.
