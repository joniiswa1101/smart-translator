# Smart Translator B: Multi-output (Individual)

## Aplikasi Penerjemah Audio Real-time Multi-bahasa untuk Training & Meeting

---

## 1. EXECUTIVE SUMMARY

**Smart Translator B** adalah aplikasi real-time speech-to-speech translation untuk training environment (1 Trainer + 3 Peserta). Setiap peserta mendengar dalam bahasa pilihan masing-masing secara individual, tanpa mengganggu peserta lain. Cocok untuk training B2B, workshop multinasional, dan call center training di Indonesia.

**Bahasa support:** Indonesia (ID), English (EN), Bengali (BN) — siap ditambah bahasa baru.

**Cara kerja inti:**
1. Semua HP peserta mic ON secara terus-menerus
2. Voice Activity Detection (VAD) mendeteksi bicara
3. Server mengunci giliran — 1 orang bicara setiap saat
4. Pipeline: Speech → ASR (transcribe) → Translate → TTS (text-to-speech)
5. Audio diterjemahkan → dikirim ke setiap peserta dalam bahasa masing-masing

---

## 2. PROBLEM STATEMENT

**Target Market:**
- Perusahaan multinasional dengan karyawan multilingual (Indonesia + ekspatriat)
- Training center yang mendatangkan trainer dari luar negeri
- Call center yang melatih agen untuk handle bahasa asing
- Pabrik/manufaktur dengan tenaga kerja dari berbagai negara

**Pain Points:**
1. **Language barrier di training** — Trainer berbahasa Inggris, peserta tidak mengerti
2. **Interpreter mahal** — Biaya ~Rp 2-5 juta/hari untuk interpreter on-site
3. **Interpreter tidak akurat** — Terutama untuk terminologi teknis/training
4. **Manual & tidak scalable** — Sulit dapat interpreter untuk 5 lokasi sekaligus
5. **Bengali underserved** — Tidak ada solusi terpadu untuk bahasa Bengali di Indonesia

**Market Size (Indonesia):**
- Perusahaan dengan ekspatriat: ~8,000 perusahaan
- Training center B2B: ~2,500
- Call center: ~150,000 agen (multi-site)
- Manufaktur: ~200 pabrik besar dengan tenaga kerja asing

---

## 3. FITUR UTAMA

### 3.1 Auto-VAD (Voice Activity Detection)
- **Mic always-on** — Tidak perlu tombol push-to-talk
- **Client-side detection** — RMS amplitude + silence timer
- **False-positive filter** — Minimum 1.4 detik bicara untuk trigger
- **Auto lockout** — HP lain yang mendengar tidak trigger mic sendiri
- **Auto-commit** — Setelah 1.5 detik silence, otomatis kirim ke translate

### 3.2 Individual Audio Routing
- Setiap peserta mendengar **hanya bahasa-nya sendiri**
- Trainer bicara English → Peserta A dengar Indonesia, Peserta B dengar Bengali, Peserta C dengar English
- Skip jika bahasa sumber = bahasa target (tidak ada echo)

### 3.3 Trainer Mode (Priority Override)
- Trainer bisa "steal" giliran dari peserta kapan saja
- Trainer dapat toggle trainer mode on/off
- Peserta tidak bisa mencuri giliran trainer

### 3.4 Domain Glossary (300+ istilah)
- Glosarium training: keselamatan, prosedur, inspeksi, maintenance
- Meningkatkan akurasi transkripsi & terjemahan
- Dapat dikustomisasi per-klien (SOP, terminologi perusahaan)

### 3.5 Real-time Latency Metrics
- **Total gap:** Waktu dari bicara sampai audio keluar (typical 1500-4000ms)
- **Audio fan-out log:** Setiap turn dilog — siapa dengar apa
- **Debugging ground truth:** Server log per turn per participant

### 3.6 Multi-device Support
- Semua HP peserta membuka browser → join ruang dengan kode
- No app install needed (progressive web app via browser)
- Auto-reconnect jika network drop
- WebSocket connection dengan generation guard (anti double-join)

### 3.7 Language Switching (Real-time)
- Peserta bisa ganti bahasa bicara tanpa keluar ruangan
- Instant broadcast ke semua peserta

---

## 4. ARSITEKTUR TEKNIS

### 4.1 Pipeline Audio
```
HP Peserta (Mic ON → VAD)
  → Server (WebSocket)
    → OpenAI gpt-4o-transcribe (ASR + language hint)
      → OpenAI gpt-4o (Translate + glossary context)
        → OpenAI gpt-4o-mini-tts (Text-to-Speech + language instructions)
          → Fan-out ke setiap peserta (filtered by hearLang)
```

### 4.2 Stack
- **Backend:** Node.js 24, Express 5, TypeScript 5.9
- **Frontend:** Vanilla HTML/JS (no framework — untuk kompatibilitas HP lama)
- **Audio:** Web Audio API (ScriptProcessorNode), 24kHz PCM16
- **WebSocket:** Server-managed (in-memory), custom protocol
- **AI APIs:** OpenAI (gpt-4o-transcribe, gpt-4o, gpt-4o-mini-tts)
- **Build:** esbuild (CJS bundle)
- **Monorepo:** pnpm workspaces

### 4.3 Data Flow Detail

**Turn Lifecycle:**
1. **IDLE** → Peserta bicara → VAD detect (8 frames / 1.4 detik)
2. **Turn Request** → Kirim ke server
3. **Turn Granted** → Server broadcast `turn.granted` ke semua
4. **Listening** → Mic capture audio → stream ke server (audio.append)
5. **Silence Detected** → Auto-commit (audio.commit)
6. **Processing** → Server: ASR → Translate → TTS (parallel per bahasa)
7. **Playing** → Audio chunk dikirim ke peserta (filtered by hearLang)
8. **Completed** → Log turn, reset state

### 4.4 Model AI & Cost
| Service | Model | Purpose | Cost Estimasi |
|---------|-------|---------|---------------|
| ASR | gpt-4o-transcribe | Speech-to-text | ~$0.006/min |
| Translate | gpt-4o | Text translation | ~$0.002/1K tokens |
| TTS | gpt-4o-mini-tts | Text-to-speech | ~$0.015/min |
| **Total** | | | **~$0.02-0.03/min per turn** |

**Perbandingan dengan interpreter manusia:**
- Interpreter on-site: Rp 2-5 juta/hari (8 jam = ~$130-330)
- Smart Translator B: ~$1.20-1.80 per jam training
- **Hemat 95%+ untuk 1 training session**

---

## 5. KEAMANAN & PRIVASI

- **Ephemeral secret pattern** — API key OpenAI tidak pernah keluar dari server
- **Client secret** — Server mint short-lived secret untuk koneksi
- **No persistent audio storage** — Audio dihapus setelah turn selesai
- **In-memory rooms** — Tidak ada database, tidak ada data tersimpan
- **WebSocket encryption** — TLS/mTLS via proxy
- **Trainer control** — Trainer bisa kick/mute peserta (planned)

---

## 6. PENDEKATAN MONETISASI (Market Indonesia)

### 6.1 Model Revenue

**A. Subscription SaaS (Rekomendasi Utama)**
| Tier | Fitur | Harga/Bulan |
|------|-------|-------------|
| **Free** | 1 ruang, 2 peserta, 30 menit/hari | Gratis |
| **Basic** | 3 ruang, 5 peserta, unlimited | Rp 499.000 |
| **Pro** | 10 ruang, 20 peserta, analytics | Rp 1.499.000 |
| **Enterprise** | Unlimited, custom glossary, SLA, support 24/7 | Custom (Rp 5-20 juta) |

**B. Pay-per-Use**
- Rp 5.000 per jam per peserta
- Cocok untuk training sporadik (1x per bulan)

**C. Per-Training-Event (Enterprise)**
- Rp 500.000 - 2 juta per training event (tergantung durasi & peserta)
- Cocok untuk training center yang tidak mau commitment bulanan

**D. White-label / OEM**
- License source code untuk perusahaan besar (bank, telco, manufaktur)
- Setup on-premise / private cloud
- Harga: Rp 50-200 juta setup + Rp 5-10 juta/bulan maintenance

### 6.2 Estimasi TAM/SAM/SOM (Indonesia)

| Metric | Value |
|--------|-------|
| **TAM** (Total Addressable Market) | 8,000 perusahaan multinasional × Rp 5 juta/bulan = **Rp 40 miliar/bulan** |
| **SAM** (Serviceable Addressable Market) | 2,500 training center + call center × Rp 1 juta/bulan = **Rp 2.5 miliar/bulan** |
| **SOM** (Serviceable Obtainable Market) | Year 1: 50 klien × Rp 500.000 = **Rp 25 juta/bulan** |

---

## 7. STRATEGI LISENSI

### 7.1 Perbandingan Model Lisensi

| Model | Deskripsi | Cocok untuk |
|-------|-----------|-------------|
| **SaaS Subscription** | Cloud-hosted, bayar bulanan/tahunan | Training center, call center |
| **Perpetual License** | Bayar sekali, own forever + annual maintenance | Bank, telco, government |
| **Usage-based** | Bayar per menit/peserta | Training sporadik, event |
| **White-label OEM** | Rebrand, on-premise | Perusahaan besar yang ingin control |
| **API License** | License API untuk integrasi ke platform lain | LMS, HR platform, meeting app |

### 7.2 Rekomendasi untuk Indonesia

**Primary: SaaS Subscription + API License**

**Kenapa:**
1. Market Indonesia prefer **bayar bulanan** (tidak mau capex besar)
2. Training center butuh **predictable cost**
3. Integrasi dengan LMS/HRIS platform sudah ada demand
4. Enterprise lebih suka **cloud** daripada on-premise (IT team kecil)

**Secondary: White-label untuk Enterprise**
- Bank, telco, manufacturing yang punya data sensitif
- Government yang butuh on-premise (sovereignty)

---

## 8. KEUNGGULAN KOMPETITIF

### 8.1 vs Interpreter Manusia
| Aspek | Interpreter | Smart Translator B |
|-------|-------------|-------------------|
| Cost/hari | Rp 2-5 juta | Rp 100-200 ribu |
| Availability | Booking 1-2 minggu | Instant |
| Scale | 1-2 orang | Unlimited |
| Terminologi | Bergantung interpreter | Consistent (glossary) |
| Record & replay | Manual | Otomatis (log) |
| Bengali | Sangat sulit cari | Support native |

### 8.2 vs Google Translate / Zoom
| Aspek | Google Translate | Smart Translator B |
|-------|-----------------|-------------------|
| Real-time audio | Tidak (text only) | Ya (speech-to-speech) |
| Individual routing | Tidak (broadcast) | Ya (per-orang) |
| Training glossary | Tidak | Ya (300+ terms) |
| Trainer mode | Tidak | Ya (priority override) |
| Auto-VAD | Tidak | Ya (hands-free) |
| Bengali TTS | Terbatas | Full (gpt-4o-mini-tts) |

---

## 9. RISIKO & MITIGASI

| Risiko | Probabilitas | Impact | Mitigasi |
|--------|-------------|--------|----------|
| **Bengali ASR akurasi rendah** | Tinggi | Tinggi | Switch ke gpt-4o-transcribe + auto-detect; user training |
| **Baterai HP habis cepat** | Tinggi | Sedang | Mic auto-off saat idle 5 menit; battery saver mode |
| **False trigger VAD** | Sedang | Sedang | Durasi minimum naik; server-side filter post-ASR |
| **Latency tinggi (4 detik)** | Sedang | Sedang | Pipeline parallel; CDN untuk audio distribution |
| **OpenAI API naik harga** | Rendah | Tinggi | Multi-provider fallback (Google, Anthropic) |
| **Competitor masuk** | Sedang | Tinggi | First-mover di Indonesia; domain glossary moat |

---

## 10. ROADMAP

### Phase 1 (MVP — Sekarang)
- ✅ Auto-VAD + mic lockout
- ✅ 3 bahasa (ID, EN, BN)
- ✅ Individual audio routing
- ✅ Trainer mode
- ✅ Domain glossary
- ✅ Metrics & logging

### Phase 2 (1-2 bulan)
- Dashboard admin (web)
- Room analytics (who spoke when, for how long)
- Export transcript & audio
- Custom glossary per-klien
- Mobile app (PWA wrapper)

### Phase 3 (3-6 bulan)
- Tambah bahasa: Mandarin, Thai, Hindi, Arab
- Noise cancellation AI (Krisp integration)
- Speaker diarization (bedakan suara di ruangan yang sama)
- On-premise deployment option

### Phase 4 (6-12 bulan)
- API platform untuk integrasi LMS/HRIS
- AI training assistant (summarize, quiz generator)
- White-label offering
- International expansion (ASEAN)

---

## 11. TIMELINE & RESOURCE

**Team untuk Phase 1-2:**
- 1 Backend engineer (Node.js/WebSocket)
- 1 Frontend engineer (HTML/JS, PWA)
- 1 AI/ML engineer (prompt engineering, pipeline optimization)
- 1 Product/QA

**Estimasi waktu Phase 1-2:** 2-3 bulan
**Estimasi cost Phase 1-2:** Rp 150-250 juta (termasuk gaji team + OpenAI API)

---

## 12. KEY METRICS (KPI)

| Metric | Target |
|--------|--------|
| Turn detection accuracy | >95% (false positive <5%) |
| Translation accuracy (ID-EN) | >90% |
| Translation accuracy (BN) | >70% (improving) |
| End-to-end latency (avg) | <3 detik |
| Audio fan-out success rate | >99% |
| User satisfaction (NPS) | >50 |
| Monthly active rooms | 100 (Year 1) |
| Revenue (Year 1) | Rp 300-500 juta |

---

## 13. CATATAN KHUSUS

**Kendala Bengali:**
- gpt-4o-transcribe lebih baik dari whisper-1 untuk Bengali
- Tapi akurasi masih perlu divalidasi dengan audio nyata (bukan TTS)
- Bengali sebagai INPUT masih weaker dibanding OUTPUT
- **Workaround:** Shorten sentences, speak clearly, quiet room

**Solusi A (Broadcast) — STATUS:**
- Di-hide dari menu nav, tapi file tetap ada
- Bisa diakses via `/room` langsung
- **Warning:** Kalau Solusi B sudah final & stable, Solusi A harus dihapus

---

## 14. KESIMPULAN

**Smart Translator B** adalah solusi yang tepat untuk masalah language barrier di training & meeting environment Indonesia. Dengan:
- **Cost 95% lebih murah** dari interpreter manusia
- **Auto-VAD** yang hands-free
- **Individual routing** yang unik
- **Domain glossary** yang meningkatkan akurasi

Aplikasi ini punya **moat yang kuat** (glossary + trainer mode + pipeline optimization) dan **market yang besar** (8,000+ perusahaan multinasional di Indonesia).

**Rekomendasi monetisasi:** SaaS Subscription (Rp 499rb - 1.5jt/bulan) + Enterprise White-label.

---

*Dokumen ini dibuat untuk valuasi aplikasi dan perencanaan lisensi.*
*Versi: 1.0 | Tanggal: Juni 2026*
