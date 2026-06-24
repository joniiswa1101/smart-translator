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
- [ ] **A5.1** Metrik latency: model_first_byte, total_turn_gap, session stats
- [ ] **A5.2** Uji ID → EN (accuracy)
- [ ] **A5.3** Uji EN → ID (accuracy)
- [ ] **A5.4** Uji BN → ID (accuracy — Bengali) / catat kualitas
- [ ] **A5.5** Uji 2 orang bicara berselang (anti-interferensi)
- [ ] **A5.6** Uji 1 speaker di tengah ruang (simulasi training nyata)
- [ ] **A5.7** Screenshot metrik + export JSON untuk client

---

## Solusi B: Multi-input + Multi-output (Individual)
> Tiap orang punya mic + earphone sendiri. Pivot-teks. Latency perlu validasi.

### B1 — Fondasi & Model Pivot
- [ ] **B1.1** Pilih ASR: gpt-4o-transcribe (multi, streaming) vs whisper-1
- [ ] **B1.2** Pilih TTS: gpt-4o-mini-tts (streaming, aksara Bengali)
- [ ] **B1.3** Definisi model: Participant = {name, spokenLang, hearLangs, deviceId}
- [ ] **B1.4** Uji akurasi ASR Bengali: gpt-4o-transcribe vs whisper-1
- [ ] **B1.5** Uji akurasi TTS Bengali: aksara বাংলa benar atau tidak
- [ ] **B1.6** Uji latensi per tahap (ASR / translate / TTS) tanpa streaming

### B2 — Pipeline Pivot-Teks
- [ ] **B2.1** Service ASR: audio → teks + deteksi bahasa (batasi kandidat ID/EN/BN)
- [ ] **B2.2** Service Translate: teks → target bahasa (paralel, batched)
- [ ] **B2.3** Service TTS: per bahasa target → audio (paralel)
- [ ] **B2.4** Hub router: hitung bahasa target yang dibutuhkan setiap peserta (selain sumber)
- [ ] **B2.5** Routing deterministik: ID → [EN, BN], EN → [ID], BN → [ID, EN] — sesuai peserta
- [ ] **B2.6** Tampilkan transkrip sumber untuk koreksi (log tabel, seperti sekarang)
- [ ] **B2.7** Glosarium domain: topik training + istilah kunci untuk meningkatkan akurasi

### B3 — Server Multi-output (Fan-out)
- [ ] **B3.1** Persistensi room (in-memory, tanpa database)
- [ ] **B3.2** WebSocket per peserta (koneksi persistent)
- [ ] **B3.3** Fan-out audio: tiap peserta terima HANYA versi bahasa-nya sendiri
- [ ] **B3.4** Fan-out teks: tiap peserta terima transkrip + terjemahan di UI
- [ ] **B3.5** Penanganan reconnect / jaringan putus
- [ ] **B3.6** Sinkronisasi: semua peserta dengar dalam urutan yang sama

### B4 — UI Klien (per peserta, individual)
- [ ] **B4.1** Halaman "Join Room": nama + pilih bahasa bicara + bahasa dengar
- [ ] **B4.2** Indikator: siapa yang bicara (audio visualizer)
- [ ] **B4.3** Panel peserta (daftar semua orang di ruang, bahasa masing-masing)
- [ ] **B4.4** Log transkrip: sumber ( bahasa ) + terjemahan (bahasa saya) — personal
- [ ] **B4.5** Audio output ke earphone (satu stream per peserta)

### B5 — Optimasi Latency (Streaming)
- [ ] **B5.1** ASR partial → kirim teks parsial ke translate begitu tersedia
- [ ] **B5.2** Translate partial → mulai TTS begitu token terjemahan muncul
- [ ] **B5.3** TTS streaming → audio mulai diputar sebelum selesai generate (chunked)
- [ ] **B5.4** Ukur latency per tahap: ASR → Translate → TTS → Network
- [ ] **B5.5** Target: dead-air < 2.5 detik (validasi dengan data nyata)

### B6 — Ukur & Verifikasi
- [ ] **B6.1** Uji 1 Trainer + 1 Peserta (baseline)
- [ ] **B6.2** Uji 1 Trainer + 3 Peserta (full)
- [ ] **B6.3** Uji antrian bicara (2 orang berbicara sebelum selesai terjemahan)
- [ ] **B6.4** Uji akurasi BN di ruang nyata (bising, gema)
- [ ] **B6.5** Perbandingkan: Solusi A vs B latency + akurasi
- [ ] **B6.6** Dashboard metrik per tahap (ASR/translate/TTS), export JSON
- [ ] **B6.7** Keputusan: B jadi produk utama atau A + B sebagai opsi

---

## Pembagian Checklist

| Item | Status | Tanda |
|------|--------|-------|
| - [ ] | Belum mulai | ⬜ |
| - [ ] | Sedang dikerjakan | 🔄 |
| - [x] | Selesai | ✅ |

---

*Dibuat: Juni 2026. Akan di-update saat implementasi berjalan.*
