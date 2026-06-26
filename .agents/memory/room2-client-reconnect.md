---
name: Room2 client WebSocket reconnect
description: Why the room2 listener silently misses translations, and the safe reconnect pattern
---

# Room2 listener "mana terjemahannya" (missing translation) root cause

A listener phone reported translations not arriving. Server logs (the "Audio fan-out summary" diagnostic) proved the server sent the correct target-language audio. The real cause was the **client WebSocket dropping mid-turn** (mobile backgrounding / network blip), with no reconnect — the old `onclose` just kicked the user to the join screen, so any turn that completed while they were briefly disconnected was lost.

**Rule:** the room2 client must auto-reconnect + auto-rejoin on unexpected close, and only go to the join screen on user-initiated leave or after exhausting retries.

**Why:** real-world mobile clients churn connections constantly; without reconnect the listener silently misses turns and blames translation accuracy.

**How to apply (safe reconnect):**
- Guard user-initiated leave with a flag so `onclose` doesn't reconnect after an intentional exit.
- Use a connection **generation token** (`wsGeneration`, captured per-socket as `myGen`) and a **local** `socket` reference in handlers — never the mutable global `ws`. Every handler returns early if `myGen !== wsGeneration`. This prevents stale superseded sockets from double-joining or duplicating UI updates during rapid reconnect churn.
- Tear down the previous socket (null its handlers + close) before opening a new one, so only one connection is ever live.
- Backoff: `min(1000 * attempts, 5000)`, cap ~10 attempts, then fall back to join screen.

# Diagnostic-logging-first approach

When a user insists "I hear the wrong language" but server routing looks correct, add a per-turn **fan-out summary log** (for each participant: name, role, hearLang, and the exact `lang:"text"` they receive) and have the user reproduce once. Reading their real session's fan-out is ground truth and ends speculation — synthetic WS tests can't capture client-side disconnect/cache issues.
