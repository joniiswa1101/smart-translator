---
name: Room access control
description: How room codes and trainer role are secured against enumeration and privilege escalation.
---

## Rule
Room codes are 8 cryptographically-random characters from a 36-char alphabet (36^8 ≈ 2.8 trillion possibilities). Trainer role is granted **only** by the server, by comparing a `trainerToken` presented at join time against the room's stored token (128-bit random secret generated at room creation). Client-supplied role claims are discarded.

**Why:** Original codes were `TR` + 2 chars (1,296 total) — trivially brute-forceable. Any client that sent `"role":"trainer"` in `room.join` was immediately granted trainer privileges, enabling turn cancellation and session disruption.

**How to apply:**
- `createRoom()` / `createRoom2()` return `{ code, trainerToken }`. The token must be included in the API response (`POST /api/room`, `POST /api/room2`, `POST /api/platform/room`) and is intended only for the trainer (not shared with participants).
- `joinRoom()` / `joinRoom2()` signature changed: third arg is `trainerToken: string | undefined` (not `role`). Role is computed internally.
- WS handlers (`room-ws.ts`, `room2-ws.ts`) extract `trainerToken` from the join message, pass it to `joinRoom`, and use `participant.role` (server-determined) in all responses/broadcasts.
- UI (`room.html`, `room2.html`): "Buat Ruang Baru" auto-fills token into a "Token Trainer" field; reconnect re-sends the in-memory token. A trainer who refreshes must re-enter the token (displayed at creation).
