# OnCallDev end-to-end Telegram and voice flows

## Milestone goal

Make TeleClaw feel daily-usable for a real Telegram user by hardening text, voice, approvals, status answers, and failure recovery messaging.

## Audit before this milestone

### Text request flow

- Flow existed end-to-end (intent -> project -> runtime -> worker -> reply).
- Rough edges:
  - Some replies surfaced raw worker-centric phrasing.
  - Project-switch context was easy to lose in the final user message.
  - Runtime and worker failures could be technically correct but not user-friendly.

### Voice request flow

- Voice messages could enter TeleClaw, but transcript failures were not strongly handled.
- Rough edges:
  - Missing/weak transcripts could still route into execution as low-quality text.
  - Voice reply fallback to text worked implicitly but with limited explicit user feedback.

### Approval-required flow

- Durable approval state and control loop existed.
- Rough edges:
  - Prompts were functional but minimal.
  - “What are you waiting for?” needed clearer, user-facing status wording.
  - Approve/reject confirmations benefited from tighter conversational copy.

### Status query flow

- Structured execution state and summary fallback already existed.
- Rough edges:
  - Coverage of natural status phrasings was narrower than real-user language.
  - Status framing did not always clearly mention what TeleClaw was blocked on.

### Runtime and worker failure flow

- Durable event persistence was already strong.
- Rough edges:
  - User-facing replies for runtime reconcile/ensure/validate and worker errors were terse and internal-sounding.
  - Recovery attempts/state changes were not always phrased as “what happened and what to do next”.

### Restart and stale runtime flow

- Reconciliation and restart paths existed.
- Rough edges:
  - User-visible explanation of stale/unavailable runtime outcomes needed clearer language.

## Target flow after this milestone

### 1) Text request -> project resolution -> execution -> useful reply

- Keep project context explicit when switching projects.
- Keep final replies concise and task-oriented.
- Translate worker/runtime states into human-friendly wording.

### 2) Voice note -> transcription -> execution -> text/voice reply

- Normalize voice requests through the same router path as text.
- Persist transcript provider/quality metadata in TeleClaw memory events.
- Return a clear clarification prompt when transcript quality is missing/weak.
- Use voice replies when configured; otherwise cleanly fall back to text.

### 3) Risky task -> approval request -> natural-language approve/reject -> continue/cancel

- Approval prompts explicitly state action, project, and reason.
- Approve/reject confirmations are short and unambiguous.
- “What are you waiting for?” answers from durable approval state.

### 4) Status questions -> strong answers from durable state

- Prefer structured execution state first.
- Fall back to rolling summaries only when needed.
- Support broader natural status phrasings (tests, current activity, recent updates).

### 5) Failure conditions -> clear explanation and graceful recovery

- Runtime and worker failures explain what failed, what TeleClaw did next, and what the user can do.
- Keep raw diagnostics in durable state/events; keep user-facing replies concise.

### 6) Restart and stale runtime behavior

- Runtime reconcile/ensure/validate states remain durable.
- User-facing replies make stale/missing runtime conditions understandable.

## Known limitations after this milestone

- STT/TTS providers remain integration seams; production provider wiring is still TODO.
- Approval policy remains text-pattern based (not full semantic plan analysis).
- One pending approval per session remains the supported model.
- OpenHands internals remain abstracted; TeleClaw continues to normalize worker output heuristically where needed.

## Day-to-day operator checks

- Enable TeleClaw routing: `ONCALLDEV_ENABLED=1`.
- Validate runtime health via status queries before long runs.
- For voice, ensure STT/TTS secrets are present when voice-in/voice-out is required.
- Use “what are you waiting for?” as the first check when execution appears paused.
