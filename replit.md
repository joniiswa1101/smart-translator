# Smart Translator Training

Sistem multi-bahasa (Indonesia, Inggris, Bengali) untuk 1 Trainer + 3 Peserta. Dua solusi: **A** (multi-input + single-output broadcast) dan **B** (multi-input + multi-output individual). Dibangun di atas proyek "Voca Interpreter Latency Test" asli.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (serves app at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- Required env: `OPENAI_API_KEY` — used server-side only (ephemeral secrets, whisper-1, gpt-4o-mini, tts-1)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Frontend: Single HTML files (vanilla JS + CSS, no framework)
- Build: esbuild (CJS bundle)
- WebSocket: Server-managed (in-memory) + OpenAI APIs

## Where things live

### Solusi A (Broadcast / Single Output)
- `artifacts/api-server/src/room.ts` — Room model (single output)
- `artifacts/api-server/src/room-ws.ts` — WebSocket handler (proxies to OpenAI gpt-realtime)
- `artifacts/api-server/src/routes/room.ts` — REST API /api/room
- `artifacts/api-server/public/index.html` — UI klien Solusi A (join room, broadcast, metrics)

### Solusi B (Multi-output / Individual)
- `artifacts/api-server/src/room2.ts` — Room2 model (multi-output, spokenLang + hearLang)
- `artifacts/api-server/src/room2-ws.ts` — WebSocket handler (pivot-teks: ASR → Translate → TTS → fan-out)
- `artifacts/api-server/src/routes/room2.ts` — REST API /api/room2
- `artifacts/api-server/public/room2.html` — UI klien Solusi B (individual routing, metrics)
- `artifacts/api-server/src/glossary.ts` — Glosarium domain (300+ istilah training)

### Shared
- `artifacts/api-server/src/app.ts` — Express app, static file serving
- `artifacts/api-server/src/routes/session.ts` — POST /api/session (mints ephemeral OpenAI client secret)
- `artifacts/api-server/src/lib/logger.ts` — Pino logger

## Architecture decisions

- **Ephemeral secret pattern (A)**: Server mints short-lived OpenAI client secret for gpt-realtime. API key never leaves the server.
- **Pivot-teks (B)**: Audio → whisper-1 ASR → gpt-4o-mini translate → tts-1 TTS → chunked fan-out. Lebih fleksibel, lebih murah, ~60% lower cost.
- **Individual routing (B)**: Tiap peserta dengar hanya bahasa yang diinginkan (hearLang). Skip jika sama dengan sumber.
- **Speaker lock**: Selama ada peserta aktif bicara, yang lain tidak bisa mencuri giliran.
- **VAD is client-side**: RMS amplitude + silence timer. Threshold 0.02, 1.5s silence.
- **24kHz PCM16**: Matches OpenAI spec for both realtime and tts-1.
- **Static file path detection**: `existsSync` picks the right `public/` path automatically.

## Solusi A: Single Output (Broadcast)
- **Pipeline**: Client → Server → OpenAI gpt-realtime → Fan-out ke semua
- **Routing**: ID → EN, EN → ID, BN → ID (tapi BN tidak didukung oleh gpt-realtime)
- **Latency**: ~800-1200ms (realtime streaming)
- **Limitasi**: Hanya 2 bahasa, semua dengar sama

## Solusi B: Multi-output (Individual)
- **Pipeline**: Client → Server → whisper-1 ASR → gpt-4o-mini translate → tts-1 TTS → Fan-out individual
- **Routing**: Tiap peserta terima audio/text dalam hearLang-nya masing-masing
- **Latency**: ~1500-4000ms (tergantung panjang ucapan)
- **Keunggulan**: 3 bahasa, individual, lebih murah, lebih fleksibel
- **Rekomendasi**: Solusi B untuk produksi

## User preferences

- Project title: "Smart Translator Training"
- Target: 1 Trainer + 3 Peserta (ID, EN, BN)
- Dual solution: A (broadcast, legacy) dan B (individual, rekomendasi)
- Focus: Latency + accuracy measurement + multi-language support

## Gotchas

- Always run from workspace root with `pnpm --filter`
- `/room2.html` untuk Solusi B, `/` untuk Solusi A
- `/room2-ws` WebSocket untuk Solusi B, `/ws` (proxy) untuk Solusi A
- Solusi B pakai `tts-1` (bukan gpt-4o-mini-tts) karena tidak support streaming
- Voice mapping: id=allo, en=echo, bn=alloy
- Bengali sebagai OUTPUT (Dengar/hearLang BN) didukung penuh: gpt-4o-mini translate→bn + tts-1→bn. Validasi akurasi butuh audio nyata.
- Bengali sebagai INPUT (Bicara/spokenLang BN) TIDAK didukung resmi oleh whisper-1: param `language=bn` ditolak 400 (unsupported_language). Solusi: jangan kirim language hint untuk bn (auto-detect). Hint hanya untuk id/en (lihat WHISPER_HINT_LANGS di room2-ws.ts). Akurasi ASR Bengali tetap tidak terjamin.

## Pointers

- `docs/B6.5-comparison.md` — Perbandingan detail A vs B
- `checklist-translator.md` — Checklist implementasi lengkap (A1-A5, B1-B6)
- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
