# Smart Translator Training - Implementation Checklist

## Solusi B: Multi-output (Individual) - Status Implementation

---

### Core Architecture

- [x] **Express 5 backend** dengan TypeScript
- [x] **WebSocket server** (`room2-ws.ts`) untuk real-time communication
- [x] **In-memory room management** (`room2.ts`) - tidak perlu database untuk state
- [x] **Static file serving** dengan cache-control no-store
- [x] **Pino logger** untuk server-side logging

---

### Audio Pipeline (Pivot-teks)

- [x] **ASR: gpt-4o-transcribe** dengan language hint (id/en auto-detect, bn native)
- [x] **Translate: gpt-4o** dengan domain glossary context
- [x] **TTS: gpt-4o-mini-tts** dengan language-specific instructions
- [x] **Voice mapping**: id=nova, en=echo, bn=alloy
- [x] **24kHz PCM16** audio format (matches OpenAI spec)
- [x] **Fan-out individual** ke setiap peserta berdasarkan hearLang

---

### Auto-VAD (Voice Activity Detection)

- [x] **Mic always-on** setelah join room (tidak perlu manual button)
- [x] **Client-side VAD** dengan RMS amplitude + silence timer
- [x] **Auto turn.request** saat suara terdeteksi (semua role)
- [x] **Auto turn.cancel** setelah 1.5 detik silence
- [x] **False-positive filter**: minimum 8 voiced frames (~1.4 detik)
- [x] **Counter reset**: voicedFrames reset setelah 5 frame silence
- [x] **VAD meter** visual (bar hijau) di UI
- [x] **VAD status indicator**: Mic aktif / Mendengarkan / Orang lain bicara

---

### Turn Management

- [x] **Single speaker lock**: hanya 1 orang bicara setiap saat
- [x] **Turn request queue**: server manage giliran
- [x] **Turn granted**: broadcast ke semua peserta
- [x] **Turn rejected**: peserta lain mendapat notif "Tunggu giliran"
- [x] **Turn completed**: auto reset state, log metrics
- [x] **Turn cancelled**: manual atau auto on silence

---

### Trainer Mode

- [x] **Trainer mode toggle** (enable/disable)
- [x] **Trainer priority**: trainer bisa "steal" giliran kapan saja
- [x] **Trainer auto-VAD**: trainer VAD trigger turn.request otomatis
- [x] **Trainer lockout override**: trainer tidak ter-lockout oleh peserta

---

### Mic Lockout (Echo Prevention)

- [x] **isLockedOut flag**: device lain dikunci saat ada speaker aktif
- [x] **Lock on turn.granted** (untuk orang lain): suppress VAD trigger
- [x] **Unlock on turn.completed/turn.cancelled**: mic kembali aktif
- [x] **Cooldown 3 detik** setelah turn.rejected: prevent rapid retry

---

### Audio Buffer & Anti-Cutoff

- [x] **pendingAudioBuffer**: capture audio sebelum turn.granted
- [x] **Buffer flush**: otomatis saat turn.granted tiba
- [x] **Prevent first-words loss**: audio dari tap-mic sampai grant tidak hilang

---

### Multi-language Support

- [x] **3 bahasa**: Indonesia (id), English (en), Bengali (bn)
- [x] **Individual routing**: tiap peserta dengar bahasa masing-masing
- [x] **Real-time language switching**: peserta ganti bahasa tanpa keluar room
- [x] **Skip self**: speaker tidak dengar audio-nya sendiri
- [x] **HearLang locked = SpokenLang**: setiap orang selalu dengar bahasa sendiri

---

### Domain Glossary

- [x] **300+ istilah training** (ID/EN/BN)
- [x] **Glossary injection** ke prompt translate
- [x] **Context-aware translation**: terminologi teknis akurat
- [x] **buildGlossaryContext()**: helper untuk build prompt

---

### WebSocket Reliability

- [x] **Auto-reconnect**: client reconnect otomatis saat disconnect
- [x] **wsGeneration guard**: prevent double-join saat reconnect
- [x] **Exponential backoff**: retry dengan delay bertingkat
- [x] **Rejoin dengan token**: kembali ke room yang sama setelah reconnect

---

### UI/UX

- [x] **Single-page HTML** (vanilla JS, no framework)
- [x] **Mobile-optimized**: touch events, responsive layout
- [x] **VAD meter**: bar hijau real-time
- [x] **Status indicator**: dot + text (Mic aktif / Mendengarkan / dll)
- [x] **Participant list**: siapa di room, siapa yang bicara
- [x] **Transcript log**: history turn dengan source + translations
- [x] **Statistics**: total turns, avg gap, p95 gap
- [x] **Audio replay**: play audio per turn
- [x] **Language switch buttons**: ID/EN/BN toggle
- [x] **Room code display**: kode ruang untuk share
- [x] **Keluar button**: leave room cleanly

---

### Metrics & Logging

- [x] **Total gap per turn**: waktu bicara sampai audio keluar
- [x] **Audio fan-out log**: server log per participant per turn
- [x] **Client-side stats**: avg gap, p95 gap, total turns
- [x] **Server-side logging**: Pino logger untuk debugging

---

### Security & Privacy

- [x] **Ephemeral secret pattern**: OpenAI API key tidak keluar dari server
- [x] **Server-side only API calls**: client tidak akses OpenAI langsung
- [x] **No persistent audio storage**: audio dihapus setelah turn
- [x] **In-memory rooms**: tidak ada database untuk room state

---

### Solusi A (Broadcast) — Legacy

- [x] **WebSocket proxy** ke OpenAI gpt-realtime
- [x] **Single output**: semua dengar bahasa yang sama
- [x] **Latency ~800-1200ms** (realtime streaming)
- [x] **Dihide dari menu nav** (tetap bisa diakses via /room)

---

### Interpreter Test (Latency Test Rig)

- [x] **Bidirectional translate**: ID↔EN auto-detect
- [x] **Dead-air gap measurement**: ms precision
- [x] **Ditampilkan di menu nav** (referensi untuk development)

---

## Belum Diimplementasikan / Planned

### License & Monetization ✅

- [x] **Device registration** dengan browser fingerprint
- [x] **Free tier**: limit 5 turns/bulan atau 2 peserta per room
- [x] **Pro tier**: unlimited
- [x] **Usage counter**: per device per bulan
- [x] **Monthly reset**: auto reset counter tiap bulan (monthKey)
- [x] **Middleware enforcement**: block di WebSocket turn.request + room.join
- [x] **Upgrade prompt**: UI sisa kuota + CTA upgrade
- [x] **Database schema**: devices + usage_logs tables (Drizzle)

### Advanced Features (Roadmap)

- [x] **Wake Lock API**: prevent screen timeout saat training
- [x] **Dashboard admin**: web dashboard untuk monitoring ruang aktif, devices, usage trend (/admin)
- [x] **Export transcript**: CSV + JSON export
- [x] **Custom glossary per-klien**: company-specific terminology (DB-backed, REST API, pipeline integration)
- [x] **Mobile PWA**: installable app wrapper (manifest.json, service worker, auto-register)
- [x] **Tambah bahasa**: Mandarin, Thai, Hindi, Arab (+ existing ID, EN, BN = 7 bahasa total)
- [x] **Noise cancellation AI**: Web Audio high-pass filter (120Hz) + compressor + noise gate. Krisp SDK tidak tersedia via npm (butuh license eksternal).
- [x] **On-premise deployment**: Dockerfile dengan multi-stage build, PostgreSQL client, auto-push migrations, health check.
- [x] **API platform**: LMS/HRIS integration via REST API dengan API key auth (/api/platform/*)

### Test Rig (Prompt Sebelumnya - Diabaikan)

- [ ] ~~**IndexedDB + Chunked Upload**~~ - Tidak cocok untuk WebSocket streaming
- [ ] ~~**Resume dari Checkpoint**~~ - Audio tidak di-persist
- [ ] ~~**Segmented Session**~~ - Mengganggu UX training
- [ ] ~~**Full Batch Model**~~ - Tidak relevan untuk real-time
- [ ] ~~**Recall.ai Meeting Bot**~~ - Mahal, tidak cocok face-to-face
- [ ] ~~**Dashboard Komparasi 3 Model**~~ - A vs B sudah jelas

---

## Catatan Penting

- **Bengali ASR masih weak** pada real phone audio (limitasi OpenAI model, bukan kode)
- **Battery drain** karena mic always-on (perlu powerbank untuk HP)
- **Echo cancellation** sudah ada di getUserMedia (browser native)
- **Solusi A di-hide dari menu** tapi file tetap ada — akan dihapus setelah Solusi B final

---

*Dokumen ini mencerminkan status implementasi per Juni 2026.*
