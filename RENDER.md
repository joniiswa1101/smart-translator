# Deploy ke Render.com

## Opsi 1: Blueprint (Satu Klik — Direkomendasikan)

1. Fork/push repo ke GitHub
2. Buka https://dashboard.render.com/blueprints
3. Klik "New Blueprint Instance"
4. Connect repo GitHub Anda
5. Render otomatis detect `render.yaml`
6. Set `OPENAI_API_KEY` di Environment Variables
7. Klik "Apply" → Deploy otomatis

## Opsi 2: Manual Deploy

### Step 1: Create PostgreSQL Database
1. Di Render dashboard → New → PostgreSQL
2. Pilih plan (Free untuk testing)
3. Copy "Internal Database URL"

### Step 2: Create Web Service
1. New → Web Service
2. Connect repo GitHub
3. Runtime: Docker
4. Dockerfile path: `./Dockerfile`
5. Environment Variables:
   - `DATABASE_URL` = Internal Database URL dari step 1
   - `OPENAI_API_KEY` = `sk-...` (OpenAI API key Anda)
   - `PORT` = `3000`
6. Klik "Create Web Service"

### Step 3: Verifikasi
Tunggu deploy selesai, lalu buka:
- `https://your-service-name.onrender.com/room2` — Aplikasi utama
- `https://your-service-name.onrender.com/admin` — Dashboard admin
- `https://your-service-name.onrender.com/api/healthz` — Health check

## Environment Variables Wajib

| Variable | Deskripsi | Dapat dari |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Render PostgreSQL internal URL |
| `OPENAI_API_KEY` | OpenAI API key | https://platform.openai.com/api-keys |
| `SESSION_SECRET` | Random string untuk session | Auto-generate atau `openssl rand -hex 32` |
| `PORT` | Port server | `3000` (sudah set di Dockerfile) |

## Free Tier Limitations (Render)

- **Web service**: Sleep setelah 15 menit idle → bangun otomatis saat ada request (~30 detik cold start)
- **Database**: 90 hari retention, max 1GB
- **Solusi cold start**: Gunakan UptimeRobot (ping setiap 5 menit, gratis)

## Upgrade ke Paid

- **Web service**: $7/bulan → always-on, lebih cepat
- **Database**: $15/bulan → 16GB storage, backups otomatis

## Troubleshooting

### "Build failed"
- Pastikan `pnpm-lock.yaml` ada di repo
- Cek Dockerfile sudah push ke branch `main`

### "Cannot connect to database"
- Pastikan `DATABASE_URL` sudah set di Environment Variables
- Untuk free tier, gunakan "Internal Database URL" (bukan external)

### "No space left on device" (Docker build)
- Free tier Render punya 512MB disk. Dockerfile multi-stage sudah optimize size.
- Kalau masih fail, tambahkan `RUN pnpm prune --prod` sebelum production stage.

## Post-Deploy Setup

### 1. Generate API Key untuk LMS
```bash
curl -X POST https://your-app.com/api/platform/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "LMS Integration", "companyId": "company-1"}'
```

### 2. Upload Custom Glossary
```bash
curl -X POST https://your-app.com/api/glossary/company-1 \
  -H "Content-Type: application/json" \
  -d '{"entries": [
    {"term": "SOP", "sourceLang": "id", "targetLang": "en", "translation": "SOP", "context": "procedure"}
  ]}'
```

### 3. Create Room dengan Custom Glossary
```bash
curl -X POST https://your-app.com/api/room2 \
  -H "Content-Type: application/json" \
  -d '{"glossaryId": "company-1"}'
```

## Support

- Render docs: https://render.com/docs
- Dockerfile reference: https://docs.docker.com/reference/dockerfile/
- Troubleshooting: check Render dashboard → Logs tab
