# OnCallDev voice flow

OnCallDev supports Telegram voice-note style intake by normalizing voice to text before routing.

## Inbound voice flow

1. Telegram inbound message reaches provider dispatch.
2. OnCallDev gate checks for audio media attachment.
3. Router records an `inbound_voice_message` memory event.
4. Voice service transcribes audio (or uses transcript hint if already provided).
5. Router records `inbound_voice_transcript` memory event.
6. Transcript enters normal intent and project routing flow.
7. Worker/session/memory behavior is identical to text after normalization.

## Voice service seam

`src/teleclaw/voice` exposes:

- `transcribeAudio({ audioUrl, transcriptHint? })`
- `synthesizeSpeech(text, options?)`

Current state:

- STT is scaffolded with a mock fallback and provider metadata.
- TTS is optional and only used when `ENABLE_VOICE_REPLIES=1`.
- If TTS is unavailable, replies gracefully fall back to text.

## Configuration

- `STT_PROVIDER`
- `STT_API_KEY`
- `TTS_PROVIDER`
- `TTS_API_KEY`
- `ENABLE_VOICE_REPLIES`
- `TELECLAW_VOICE_STORE_PATH` (reserved for generated voice artifacts)

## Current limitations and TODOs

- Production STT/TTS providers are not wired yet.
- Voice artifact persistence is reserved behind `TELECLAW_VOICE_STORE_PATH`.
- Telegram-specific voice metadata parsing can be expanded for richer routing analytics.
