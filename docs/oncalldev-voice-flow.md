# OnCallDev voice flow

OnCallDev supports Telegram voice-note intake by normalizing voice into text before routing.

## Current seam audit and gaps

Before this milestone, `src/teleclaw/voice` provided a mock-only STT seam:

- `transcribeAudio({ audioUrl, transcriptHint? })`
- `synthesizeSpeech(text, options?)`

Observed behavior before the real provider work:

- Voice notes entered `processVoiceInbound` and generated `inbound_voice_message` events.
- If a transcript hint was present, router used it directly.
- If STT was unavailable or not implemented, transcript was empty and routing fell back to clarification.
- TTS failures were swallowed and replies were returned as text.

The primary gap was real TTS generation for outbound voice replies.

## Target path in this milestone

1. Telegram voice note reaches TeleClaw router voice intake.
2. Router writes `inbound_voice_message` event.
3. Voice service selects an STT provider (default `faster-whisper`).
4. STT provider returns structured transcript payload:
   - `text`
   - `provider`
   - `metadata` (`language`, `duration`, `confidence`, quality signals)
5. Router writes `inbound_voice_transcript` with transcript metadata.
6. Transcript is routed through the same intent/session/project flow as text.
7. Optional voice reply is attempted only when enabled; text fallback remains default-safe.
8. Voice reply lifecycle events are persisted for debugging and operations.

## STT provider behavior

`faster-whisper` is now the default local STT backend when `STT_PROVIDER` is not explicitly set.

- Provider runtime: local Python process (`STT_PYTHON_BIN`, default `python3`)
- Inference package: `faster-whisper` (installed in local Python environment)
- Model controls: `STT_MODEL`, `STT_DEVICE`, `STT_COMPUTE_TYPE`
- Quality controls: `STT_VAD_FILTER`, `STT_MIN_CONFIDENCE`, `STT_BEAM_SIZE`
- Timeout control: `STT_PROVIDER_TIMEOUT_MS`

## TTS provider strategy (this milestone)

TeleClaw now uses a real provider path for TTS behind `src/teleclaw/voice`:

- Provider id: `openai`
- Transport: HTTPS `POST /audio/speech`
- Required env: `TTS_PROVIDER=openai`, `TTS_API_KEY`
- Optional env:
  - `TTS_BASE_URL` (defaults to `https://api.openai.com/v1`)
  - `TTS_MODEL` (defaults to `gpt-4o-mini-tts`)
  - `TTS_VOICE` (defaults to `alloy`)
  - `TTS_FORMAT` (defaults to `mp3`)
  - `TTS_OUTPUT_DIR` (defaults to `~/.openclaw/teleclaw/voice`)
  - `TTS_PROVIDER_TIMEOUT_MS` (defaults to `30000`)
  - `ENABLE_VOICE_REPLIES=1` to enable outbound voice synthesis

Generated TTS artifacts are persisted in a predictable local directory and returned to Telegram through existing media reply flow using the artifact path.

## Fallback behavior

TeleClaw always preserves text usability.

- Missing transcript or low quality transcript:
  - returns clarification message
  - does not execute ambiguous action
- STT provider missing/misconfigured/not supported:
  - returns explicit text guidance to send request as text
- STT provider runtime failure:
  - returns explicit temporary-failure message and text fallback guidance
- Voice reply unavailable / disabled / TTS failure:
  - returns text reply with concise fallback note
  - persists reason-coded events (`outbound_voice_reply_failed`, `outbound_voice_reply_fallback_text`)

## Known limitations after this milestone

- Local faster-whisper requires a Python runtime and installed package (`pip install faster-whisper`).
- Telegram voice URL fetching depends on runtime ability to fetch the attachment URL.
- TTS is optional and defaults to off unless explicitly enabled.
- OpenAI TTS requires network access and an API key; when unavailable, TeleClaw falls back to text.
- Confidence is derived from Whisper signals (`avg_logprob`, `no_speech_prob`), not a universal probability metric.
