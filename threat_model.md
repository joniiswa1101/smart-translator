# Threat Model

## Project Overview

Smart Translator Training is a Node.js/Express real-time translation service with static browser clients and WebSocket-based audio pipelines. Production-relevant code is concentrated in `artifacts/api-server`: public HTML clients call unauthenticated REST endpoints and WebSocket handlers, which in turn use a server-held `OPENAI_API_KEY` to mint realtime sessions or invoke OpenAI transcription, translation, speech, and realtime APIs. The `artifacts/mockup-sandbox` React app is a mockup-only development surface and is out of scope unless it becomes production-reachable.

Assumptions for future scans:
- Mockup sandbox is never deployed to production.
- `NODE_ENV=production` in production deployments.
- Replit terminates TLS for deployed traffic.
- This scan focuses only on vulnerabilities that would matter in production.
- The current project is not deployed yet, so production exposure is evaluated based on code reachability rather than current internet visibility.

## Assets

- **OpenAI API credentials and quota** — the backend-held `OPENAI_API_KEY` authorizes expensive upstream realtime, ASR, translation, and TTS calls. Abuse can directly create cost impact or service disruption.
- **Live meeting content** — participant names, room membership, source transcriptions, translations, and streamed audio are sensitive session data that should only be visible to intended participants.
- **Room control state** — speaker lock, trainer mode, and language routing determine who can talk, interrupt, or influence what other participants hear.
- **Browser integrity of participants** — the static clients render peer-supplied and model-generated content. If unsafe DOM sinks are present, one participant can execute script in another participant’s browser.

## Trust Boundaries

- **Browser to API boundary** — all `/api/*` routes are reached from untrusted browsers and must treat all request bodies, params, and query strings as attacker-controlled.
- **Browser to WebSocket boundary** — `/ws`, `/room-ws`, and `/room2-ws` accept persistent bidirectional traffic from untrusted clients. Join metadata, role claims, room codes, and audio are attacker-controlled.
- **Server to OpenAI boundary** — the backend calls OpenAI with a high-value secret. Any public feature that proxies those calls must prevent unauthorized use, abuse, and data leakage.
- **Participant-to-participant boundary** — names, transcripts, translations, and audio from one participant are delivered into other participants’ browsers. The receiving client must not trust peer-controlled content.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`
- **Highest-risk areas:** `artifacts/api-server/src/routes/session.ts`, `artifacts/api-server/src/ws.ts`, `artifacts/api-server/src/room-ws.ts`, `artifacts/api-server/src/room2-ws.ts`, `artifacts/api-server/public/room.html`, `artifacts/api-server/public/room2.html`
- **Public surfaces:** static pages `/`, `/room`, `/room2`, `/asr-test`; API routes under `/api`; WebSockets `/ws`, `/room-ws`, `/room2-ws`
- **Dev-only / usually ignore:** `artifacts/mockup-sandbox/**`, test scripts, generated dist files unless production code behavior is unclear

## Threat Categories

### Spoofing

This project currently relies on client-supplied room codes, roles, names, and join metadata. Because browsers are untrusted, the service must not treat a claimed `trainer` role or a guessed room code as proof of identity. Production-safe behavior requires server-side authentication or equivalent unforgeable membership secrets before granting room access or control privileges.

### Tampering

Participants can send arbitrary WebSocket messages that affect room state, turn control, language selection, and downstream model prompts. The server must validate which participant is allowed to change shared room state and must reject unauthorized or out-of-sequence control messages. Browser clients must also avoid unsafe DOM insertion of peer-controlled content.

### Information Disclosure

Room presence, participant lists, transcripts, translations, and audio are sensitive session data. Public endpoints and WebSocket joins must not let outsiders enumerate rooms or observe live content. Error handling and logging must avoid exposing secrets, but the larger disclosure risk here is unauthorized access to session data through weak room access controls.

### Denial of Service

OpenAI-backed endpoints can consume paid compute and introduce service exhaustion. Public callers must be rate-limited and authorized before they can mint realtime sessions, open proxy sockets, stream audio, or trigger transcription / translation / TTS work. Otherwise an attacker can burn API quota or monopolize room state.

### Elevation of Privilege

The application has an implicit privilege boundary between ordinary participants and the trainer role. Server-side logic must enforce that boundary independently of client assertions. Any participant who can self-assign trainer privileges, interrupt active speakers, or manipulate shared room state has effectively escalated privileges within the session.