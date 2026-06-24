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

## Multi-turn state management (client-side VAD)
Single-turn tests pass while consecutive turns fail — these races only surface across turns:
- **Gate the next response on server truth, not local timing.** Track `activeResponseId` from
  `response.created`; clear it (and `responsePending`) on `response.done`. Send `response.create`
  only when BOTH are clear. Resetting `responsePending` only at playback-end desyncs from the server:
  any early reset leaves the server's response open and every later `response.create` is rejected with
  "Conversation already has an active response in progress: resp_… " (same id stuck across all later turns).
- **Make `response.done` id-aware**: ignore a done whose id ≠ the tracked active id (a cancelled
  response's late done can otherwise clear a newer turn's gates).
- **No speculative `input_audio_buffer.clear`** on the normal send path — commit auto-clears the buffer,
  and a stray clear interleaving with append/commit causes the "0.00ms" rejection. Clear only in explicit
  recovery/reset.
- **Wait for `session.updated` before sending audio** (a `sessionReady` flag), not a fixed delay. On
  reconnect, appending before the config ack means default server-VAD briefly applies and reintroduces conflicts.
- Centralize recovery (one `abortActiveTurn`): clear watchdog, cancel only if `activeResponseId` set,
  clear input buffer, reset both gates. Wire it to ws.onerror/onclose, the watchdog timeout, and `error` events.

## Translation direction
The model only translates reliably when told to via `session.instructions`. Without it, it acts
as a generic chat assistant and can reply in arbitrary languages. **Bidirectional auto-detect works
well**: a single instruction "if the speaker speaks Indonesian translate to English; if English
translate to Indonesian" makes whisper-1 auto-detect the source and the model translate the opposite
direction. Verified accurate both ways.

## Verifying translation accuracy without a human (TTS-driven sim)
Synthetic sine waves can NOT verify translation — there is no real speech. Instead generate real
speech with OpenAI TTS and feed it through the same realtime flow:
- `POST /v1/audio/speech` with `response_format: 'pcm'` returns raw PCM16 LE 24kHz mono — exactly the
  realtime input format. Base64 it straight into `input_audio_buffer.append`, no resampling.
- Drive the full manual flow (append→commit→wait committed→response.create) and read
  `conversation.item.input_audio_transcription.completed` (source) + `response.output_audio_transcript.done` (result).

## Late input transcription vs response.done
`input_audio_transcription.completed` can arrive AFTER `response.done` (and after the turn is
finalized/logged), leaving the Source cell blank. Fix: keep a `lastLoggedTurn` ref with its DOM row;
if the completed transcript lands when `currentTurn` is null, patch the stored turn + its row cell.
In the real UI playback delays finalize by seconds so it usually arrives in time, but the patch makes
it robust. The empty Source in a TTS sim is partly an artifact of the test resolving on response.done
with no playback wait.
