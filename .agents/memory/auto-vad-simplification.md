---
name: Auto-VAD Simplification
description: Removed trainerMode distinction — all roles get hands-free Auto-VAD
created: 2026-06-27
---

## What changed (2026-06-27)

Removed the `trainerMode` checkbox and server-side logic. Previously:
- **Trainer** could check "Trainer Mode Auto" to get VAD auto-trigger
- **Peserta** had no VAD and needed a manual button (which didn't exist in the UI)

Now:
- **ALL roles** get Auto-VAD automatically
- Mic starts immediately after joining (no button needed)
- Voice detection → `turn.request` automatically
- Silence → `turn.cancel` automatically
- `role` field kept only for display labels

## Server-side changes

**room2-ws.ts:**
- Removed `trainerMode` from `room.join` message handling
- Removed `room.trainerMode` toggle message handler
- Simplified `turn.request` — no trainer steal logic. Only busy-check.

**room2.ts:**
- Removed `trainerMode: boolean` from Room2 interface
- Replaced with `createdAt: number`

**room2.ts (routes):**
- Removed `trainerMode` from API response, added `createdAt`

## Client-side changes

**room2.html:**
- Removed `join-trainer-mode` checkbox and `trainer-mode-row` div
- Removed `myTrainerMode` variable
- Removed `toggleTrainerModeUI()` function
- Removed `trainerMode` from WebSocket join message
- Removed `room.trainerMode` handler from WebSocket messages

## Why this simplification

1. **UX consistency**: Every user gets the same experience
2. **Code reduction**: ~50 lines removed across server + client
3. **Less bug surface**: No special-casing for trainer vs participant
4. **Mic lockout handles echo**: When one person speaks, others' mics are locked to prevent echo pickup — this is sufficient without trainer priority
