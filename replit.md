# Voca Interpreter Latency Test

A single-page PWA test rig for measuring consecutive interpreter mode latency on OpenAI's gpt-realtime-translate API. User speaks Indonesian → system translates to English in real-time. Measures the dead-air gap between speech end and translated audio playback with millisecond precision.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, serves app at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- Required env: `OPENAI_API_KEY` — used server-side only to mint ephemeral client secrets

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Frontend: Single HTML file with embedded CSS + vanilla JS (no framework)
- Build: esbuild (CJS bundle)
- WebSocket: Direct browser → OpenAI wss://api.openai.com/v1/realtime/translations

## Where things live

- `artifacts/api-server/src/app.ts` — Express app, static file serving
- `artifacts/api-server/src/routes/session.ts` — POST /api/session (mints ephemeral OpenAI client secret)
- `artifacts/api-server/public/index.html` — entire frontend (UI + state machine + audio capture + WebSocket)

## Architecture decisions

- **Ephemeral secret pattern**: Server mints a short-lived OpenAI client secret via the Realtime API and returns it to the browser. Browser uses that secret directly over WebSocket. API key never leaves the server.
- **Single HTML file**: No build step for frontend — simpler for a measurement tool. All logic in vanilla JS.
- **24kHz PCM16 audio**: Matches gpt-realtime-translate spec. ScriptProcessor captures Float32, converts to PCM16 before sending.
- **VAD is client-side**: Voice Activity Detection uses RMS amplitude threshold + configurable silence timer. No server-side VAD.
- **Static file path detection**: Dev script runs from `artifacts/api-server/`, prod runs from workspace root — `existsSync` picks the right `public/` path automatically.

## Product

- State machine: IDLE → LISTENING → SILENCE_DETECTED → SENDING → WAITING → STREAMING → COMPLETE → PLAYING → IDLE
- Key metrics: `model_first_byte_latency` (API responsiveness) and `total_turn_gap` (user-perceived dead-air)
- Session statistics: avg, p95 for both key metrics
- Turn log table with all timestamps and transcripts (source ID + result EN)
- Export to JSON for offline analysis

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Always run from workspace root with `pnpm --filter` — the dev script changes cwd to the artifact dir
- The WebSocket uses the `openai-insecure-api-key.<secret>` subprotocol — this is the official ephemeral secret pattern, not a real API key exposure
- `model='gpt-4o-realtime-preview-2025-06-03'` is the current model name for the realtime translate endpoint

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
