---
name: Room2 turn-state lockout (peserta macet)
description: Why non-trainer participants get permanently stuck in Solusi B, and the invariant every turn-ending path must hold.
---

# Room2 turn lockout — the trainer/peserta asymmetry

## The invariant
In the Solusi B turn state machine, the busy flags (`isListening` / `isProcessing` / `isPlaying`) plus `currentSpeaker` / `currentTurn` gate every `turn.request`. **Only a trainer in `trainerMode` can steal/recover a busy room** (the steal branch calls `cancelTurn2` before the busy check). A plain participant has no recovery path.

**Consequence:** any code path that ends/abandons a turn but leaves a busy flag set `true` makes the room permanently busy. The trainer masks it (every trainer request steals + resets), so the trainer *always* appears to work — while participants are *permanently locked out* ("peserta macet"). If a bug report says "trainer always works, participant always stuck", suspect a leaked busy-state, not the participant's mic/client.

## Two leaks that caused this (both fixed)
1. **Empty commit:** an `audio.commit` with an empty server buffer must NOT bare-`return` — it has to reset state (cancel the turn). Empty buffers happen often on mobile when mic frames are dropped before `turn.granted`.
2. **Steal during processing:** the async pipeline (ASR→translate→TTS) must re-check it still owns the turn after every `await`. If a trainer steals mid-pipeline, the stale pipeline must abort WITHOUT mutating room state — otherwise it clears the trainer's freshly-granted turn and leaves `isListening=true, currentSpeaker=null`, which `cancelTurn2` can't fix (its guard needs a matching `currentSpeaker`).

**Why:** the recovery asymmetry turns any small state leak into a hard, role-specific lockout.
**How to apply:** when touching the turn lifecycle, ensure every exit fully resets busy flags, and guard post-`await` mutations with a stale-turn check (`room.currentTurn === capturedTurn`).

## Client/server buffer agreement
The client must only count audio it actually sent (`bufferedSamples` incremented only when the `audio.append` send happens). If the client counts unsent frames it will send a bogus `audio.commit` the server can't honor, re-triggering the empty-commit leak.

## Reproduction (no real mic needed)
WS-level `.mjs` test against `ws://localhost:80/room2-ws`, audio via `tts-1` `response_format:"pcm"`. To reproduce the lockout: grant a participant a turn, send `audio.commit` with no `audio.append`, then a second `turn.request` is rejected Busy while a trainer's request is granted. To reproduce the steal race: send real audio, wait for `turn.processing`, then have the trainer `turn.request` ~400ms in.
