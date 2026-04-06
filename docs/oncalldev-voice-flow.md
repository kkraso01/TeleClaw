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

The primary gap was real local speech-to-text inference.

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

## STT provider behavior

`faster-whisper` is now the default local STT backend when `STT_PROVIDER` is not explicitly set.

- Provider runtime: local Python process (`STT_PYTHON_BIN`, default `python3`)
- Inference package: `faster-whisper` (installed in local Python environment)
- Model controls: `STT_MODEL`, `STT_DEVICE`, `STT_COMPUTE_TYPE`
- Quality controls: `STT_VAD_FILTER`, `STT_MIN_CONFIDENCE`, `STT_BEAM_SIZE`
- Timeout control: `STT_PROVIDER_TIMEOUT_MS`

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

## Known limitations after this milestone

- Local faster-whisper requires a Python runtime and installed package (`pip install faster-whisper`).
- Telegram voice URL fetching depends on runtime ability to fetch the attachment URL.
- TTS remains optional and still uses a placeholder synthesis implementation.
- Confidence is derived from Whisper signals (`avg_logprob`, `no_speech_prob`), not a universal probability metric.
