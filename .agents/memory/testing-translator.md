---
name: Testing the translator pipeline
description: How to validate Solusi B (room2) ASR→translate→TTS routing and its limits
---

# Testing Smart Translator (Solusi B / room2)

## Synthetic TTS audio CANNOT validate ASR accuracy
- **Why:** `tts-1` voices cannot pronounce Indonesian/Bengali cleanly. Whisper then
  hallucinates common phrases (e.g. "Assalamualaikum...") or garbage on that audio.
  This is an INPUT artifact, not a server bug — direct (bypass-server) transcription
  of the same synthetic clip is equally garbled.
- **How to apply:** A Node `ws` integration test against `/room2-ws` is great for proving
  the pipeline *executes and routes* correctly (source lang detected, target-language
  script correct, fan-out reaches the right participant). But ASR *text accuracy* can
  only be judged with REAL human audio — i.e. the user on a real device.

## Routing semantics (confirmed correct — don't "fix")
- Speaker hears nothing back: routing returns `[]` when a participant's spokenLang equals
  the turn's sourceLang. Do NOT assert the speaker receives their own source language.
- Non-speakers receive exactly their `hearLang`.

## Browser (Playwright) testing limit
- **The managed test browser has NO microphone device** → `getUserMedia` throws
  "Requested device not found", so the mic ON state cannot be exercised there. A mic that
  won't turn on in that environment is NOT evidence of a toggle bug.
- What IS browser-testable without a mic: page load, join flow, and hearLang auto-sync
  (DOM shows "Bicara: X · Dengar: X" matching).

## Async mic toggle needs a state machine
- **Why:** `getUserMedia` is async; gating only on a boolean `micOn` lets a second tap during
  the acquisition window launch a concurrent `startMic()`, leaking streams (bad on slow Android).
- **How to apply:** Use `micState: 'off'|'starting'|'on'` + a `pendingStop` flag. Tap during
  'starting' sets pendingStop; startMic aborts cleanly if pendingStop is set when getUserMedia
  resolves; startMic/stopMic are re-entry-guarded and idempotent.

## Trainer-mode broadcasts to ALL clients — peserta must still push-to-talk
- **Why:** Server sends `room.trainerMode` to every client via `room.joined`, so a peserta's
  local `myTrainerMode` becomes true in a trainer-mode room. If startMic defers turn.request
  to VAD whenever `myTrainerMode` is true, the peserta's mic turns on but no turn is ever
  requested → status "IDLE forever", audio rejected, no translation. (Real reported bug.)
- **How to apply:** Only the TRAINER defers to VAD: `deferToVad = myTrainerMode && myRole==='trainer'`.
  Peserta always sends turn.request on mic ON, regardless of room trainer mode.
