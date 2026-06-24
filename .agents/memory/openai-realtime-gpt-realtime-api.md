---
name: OpenAI gpt-realtime (GA) API quirks
description: Session config + manual audio buffer flow for OpenAI Realtime GA model when using client-side VAD
---

# OpenAI gpt-realtime (GA Realtime API) — manual/client-side VAD flow

For the GA `gpt-realtime` model over WebSocket (`wss://api.openai.com/v1/realtime?model=gpt-realtime`),
when the app does its OWN voice-activity detection and manual buffering:

## Session config shape (GA, NOT the beta shape)
`session.update` must use `session.type: 'realtime'`. Audio settings are nested under `audio`:
- transcription → `audio.input.transcription` (e.g. `{ model: 'whisper-1' }`).
  The old top-level `session.input_audio_transcription` is rejected: `unknown_parameter`.
- **Disable server VAD**: `audio.input.turn_detection: null`.

**Why:** Default `turn_detection` is `server_vad` with `create_response: true`. With it on, the
server auto-commits the input buffer AND auto-creates a response. That collides with manual control:
your manual `input_audio_buffer.commit` then sees an already-drained buffer → error
`input_audio_buffer_commit_empty` ("buffer too small … 0.00ms"), and your manual `response.create`
hits "Conversation already has an active response in progress". Both vanish once VAD is off.

## Correct manual turn flow
1. (optional but defensive) `input_audio_buffer.clear`
2. `input_audio_buffer.append` (PCM16, 24kHz; ≥100ms of audio or commit is rejected)
3. `input_audio_buffer.commit`
4. **Wait for the `input_audio_buffer.committed` event** before sending `response.create`.
   Do NOT fire commit + response.create back-to-back — if commit fails you still sent response.create.

**How to apply:** Track a `responsePending` flag; send `response.create` only in the `committed`
handler. Reset the flag on `response.done` and on every error/abort path. Add a watchdog timer after
commit so a lost `committed`/`response.done` event doesn't leave the UI stuck in SENDING/WAITING.

## Event names (GA)
Audio out: `response.output_audio.delta` / `.done`. Transcript out: `response.output_audio_transcript.delta` / `.done`.
Input transcript: `conversation.item.input_audio_transcription.delta` / `.completed`.
Default audio format both directions: `{ type: 'audio/pcm', rate: 24000 }`.

## Translation direction
The model only translates Indonesian→English reliably when told to via `session.instructions`
(e.g. "You are an Indonesian to English interpreter… respond only in English"). Without it, it acts
as a generic chat assistant and can reply in arbitrary languages.
