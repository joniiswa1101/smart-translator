# Checklist Implementasi: Smart Translator Training

Sistem multi-bahasa (Indonesia, Inggris, Bengali) untuk 1 Trainer + 3 Peserta.

---

## Solusi A: Multi-input + Single Output (Broadcast)
> Tiap orang punya mic (input), semua dengar dari 1 speaker (output). Pipeline speech-to-speech.

### A1 — Fondasi Server Ruang
- [x] **A1.1** Definisi model data: Room (kode ruang), Participant (nama, deviceId, micId, inputLang, active)
- [x] **A1.2** Server WebSocket (in-memory) per ruang, bisa 1 Trainer + 3 Peserta
- [x] **A1.3** API join-room: POST /api/room/{code}/join dengan kode unik (4 digit misal TR42)
- [x] **A1.4** Daftar peserta aktif di ruang, siapa sedang bicara (speaker lock)
- [x] **A1.5** Broadcast peserta ke semua (tampilan siapa di ruang)

### A2 — Multi-input Audio
- [x] **A2.1** Klien WebRTC/getUserMedia per peserta (input mic)
- [x] **A2.2** VAD di tiap klien (pakai ulang VAD sekarang) — deteksi siapa bicara
- [x] **A2.3** Kirim audio fragment (PCM 16, 24kHz) dari klien → server WebSocket
- [x] **A2.4** Server buffer audio per peserta, identifikasi "giliran" siapa
- [x] **A2.5** Speaker lock: selama ada peserta aktif bicara, yang lain tidak bisa "mencuri" giliran
- [x] **A2.6** Ucapan < 200ms dibuang (anti-bising)
- [x] **A2.7** Ucapan > 30 detik dipaksa potong (MAX_TURN_SEC)

### A3 — Routing & Terjemahan
- [x] **A3.1** Routing otomatis 3-arah: ID → EN, EN → ID, BN → ID
- [x] **A3.2** Koneksi WebSocket ke OpenAI Realtime (gpt-realtime-translate) per ruang
- [x] **A3.3** Server proxy audio ke OpenAI (pakai ulang kode /ws sekarang)
- [x] **A3.4** Terima terjemahan dari OpenAI (text + audio)
- [x] **A3.5** Fan-out audio ke SEMUA klien di ruang (single output)

### A4 — UI Klien (per peserta)
- [x] **A4.1** Halaman "Join Room": masukkan kode ruang, nama, pilih bahasa bicara
- [x] **A4.2** Tombol Mute/Unmute mic (kontrol peserta)
- [x] **A4.3** Status: "Listening…" / "Silence…" / "Terjemahan diputar…"
- [x] **A4.4** Log transkrip sumber + terjemahan (tabel)
- [x] **A4.5** Panel peserta aktif (siapa sedang bicara, siapa ada di ruang)
- [x] **A4.6** Audio output dari 1 speaker (browser) atau earphone (pilihan)

### A5 — Ukur & Verifikasi
- [x] **A5.1** Metrik latency: model_first_byte, total_turn_gap, session stats
- [x] **A5.2** Uji ID → EN (accuracy) — 4/4 akurat, source: "Selamat sore..." → "Good afternoon..."
- [x] **A5.3** Uji EN → ID (accuracy) — 4/4 akurat, source: "Thank you..." → "Terima kasih..."
- [x] **A5.4** Uji BN → ID (accuracy) — Bengali di-transliterasi Latin, bukan aksara Bengali. Perlu whisper-1 → gpt-4o-transcribe untuk perbaikan.
- [x] **A5.5** Uji 2 orang bicara berselang (anti-interferensi) — Speaker lock bekerja, participant ditolak saat trainer aktif.
- [x] **A5.6** Uji 1 speaker di tengah ruang (simulasi training nyata) — Diverifikasi via TTS simulation, 1 room + 4 peserta.
- [x] **A5.7** Screenshot metrik + export JSON untuk client — Export JSON auto ke /tmp/a5-test-{code}.json

---

## Solusi B: Multi-input + Multi-output (Individual)
> Tiap orang punya mic + earphone sendiri. Pivot-teks. Latency perlu validasi.

### B1 — Fondasi & Model Pivot
- [x] **B1.1** ASR: whisper-1 (transkripsi audio → teks)
- [x] **B1.2** TTS: tts-1 (PCM 24kHz, chunked fan-out)
- [x] **B1.3** Model: Participant2 = {name, spokenLang, hearLang, ws, active}
- [ ] **B1.4** Uji akurasi ASR Bengali: whisper-1 dengan file audio nyata
- [ ] **B1.5** Uji akurasi TTS Bengali: tts-1 output aksara Bengali
- [ ] **B1.6** Uji latensi per tahap (ASR / translate / TTS) tanpa streaming

### B2 — Pipeline Pivot-Teks
- [x] **B2.1** ASR: audio → teks (whisper-1, auto-detect bahasa)
- [x] **B2.2** Translate: teks → target bahasa (GPT-4o-mini, paralel)
- [x] **B2.3** TTS: per bahasa target → audio (tts-1, paralel, chunked)
- [x] **B2.4** Hub router: hitung bahasa target per peserta (skip jika sama dengan sumber)
- [x] **B2.5** Routing deterministik: ID → [EN], EN → [ID], BN → [ID, EN] — sesuai peserta
- [x] **B2.6** Transkrip log: tabel sumber + terjemahan per peserta
- [ ] **B2.7** Glosarium domain: topik training + istilah kunci

### B3 — Server Multi-output (Fan-out)
- [x] **B3.1** Room in-memory (Map, auto-cleanup >10 min)
- [x] **B3.2** WebSocket per peserta (/room2-ws)
- [x] **B3.3** Fan-out audio: tiap peserta terima HANYA versi bahasa-nya
- [x] **B3.4** Fan-out teks: transkrip + terjemahan personal per peserta
- [x] **B3.5** Reconnect: klien bisa join ulang ke ruang yang sama
- [x] **B3.6** Sinkronisasi: urutan turn.id global, semua peserta terima event

### B4 — UI Klien (per peserta, individual)
- [x] **B4.1** Join Room: nama + pilih bahasa bicara + bahasa dengar
- [x] **B4.2** Audio visualizer + meter VAD
- [x] **B4.3** Panel peserta dengan bahasa masing-masing
- [x] **B4.4** Log transkrip personal (sumber + terjemahan)
- [x] **B4.5** Audio output ke earphone (streaming chunk)

### B5 — Optimasi Latency (Streaming)
- [x] **B5.1** TTS chunked fan-out (~100ms chunks)
- [x] **B5.2** Parallel translate + TTS per bahasa target
- [x] **B5.3** Audio buffering & playback di klien
- [x] **B5.4** Latency per tahap tercatat di log (ASR ms, translate ms, TTS ms)
- [ ] **B5.5** Target: dead-air < 2.5 detik (perlu validasi dengan audio nyata)

### B6 — Ukur & Verifikasi
- [x] **B6.1** Uji 1 Trainer + 1 Peserta (baseline, pipeline works)
- [x] **B6.2** Uji 1 Trainer + 3 Peserta (join + routing)
- [x] **B6.3** Uji antrian bicara (speaker lock, 1 turn at a time)
- [ ] **B6.4** Uji akurasi BN di ruang nyata (bising, gema)
- [ ] **B6.5** Perbandingan: Solusi A vs B latency + akurasi
- [x] **B6.6** Dashboard metrik + export JSON
- [ ] **B6.7** Keputusan: perlu data latensi real-world

---

## Pembagian Checklist

| Item | Status | Tanda |
|------|--------|-------|
| - [ ] | Belum mulai | ⬜ |
| - [ ] | Sedang dikerjakan | 🔄 |
| - [x] | Selesai | ✅ |

---

*Dibuat: Juni 2026. Akan di-update saat implementasi berjalan.*
