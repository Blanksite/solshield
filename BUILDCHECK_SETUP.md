# SolShield® BuildCheck & `@SolShieldCheck` Setup Checklist

Semua kode Phase 1 (Web App `/buildcheck`) dan Phase 2 (X Bot `@SolShieldCheck` + Remote Chromium CDP Proxy) sudah siap pakai. Di bawah ini **hanya hal-hal yang perlu kamu isi / aktifkan** saat ingin membawa sistem ini online.

---

## 1. Akun & API Key yang Perlu Disiapkan

| Variable | Wajib / Opsional | Keterangan & Cara Dapat |
| --- | --- | --- |
| `VENICE_API_KEY` | Sangat Disarankan | Ambil di [venice.ai/settings/api](https://venice.ai/settings/api). Mengaktifkan **Vision (`qwen3-vl-235b-a22b`)** untuk membaca screenshot UI web asli + **Reasoning (`llama-3.3-70b`)** dengan Zero Data Retention. Tanpa key ini, engine fallback tetap jalan deterministik, atau user web bisa isi key lewat tombol **Venice BYOK**. |
| `SOLANA_RPC_URL` | Disarankan (Prod) | Default memakai public mainnet RPC (`api.mainnet-beta.solana.com` yg sering rate-limit). Gunakan Helius / QuickNode gratis di `.env` agar scan token selalu cepat. |
| `GITHUB_TOKEN` | Opsional | Classic/Fine-grained Personal Access Token (read-only public repos) agar limit GitHub API naik dari 60 req/jam → 5.000 req/jam. |
| `X_BEARER_TOKEN` + `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` | Wajib untuk Phase 2 Bot | Buat akun X **`@SolShieldCheck`** → daftar App di X Developer Portal (tier **Basic** untuk read mentions + reply media) → set permission **Read and Write** → generate Access Token & Secret atas nama `@SolShieldCheck`. |

---

## 2. Tes Cepat Lokal Sebelum Online (Tanpa VPS & Tanpa X API Key)

- **Web App `/buildcheck`:**
  ```bash
  npm run dev
  # lalu buka http://localhost:3000/buildcheck
  ```
- **Test Worker Bot + Generate PNG Evidence Card secara lokal:**
  ```bash
  npm run bot:check -- "https://github.com/Blanksite/solshield"
  # Output PNG tersimpan di worker/out/evidence-*.png dan draft balasan X dicetak di terminal
  ```

---

## 3. Setup VPS (Ubuntu 24.04 — 2 GB RAM, ~$5–$6/bln)

Satu VPS ringan cukup untuk menjalankan **2 service sekaligus** lewat PM2:
1. **`solshield-bot`** — mendengar mention `@SolShieldCheck` 24/7, membuka link di Chromium, audit via Venice AI, dan membalas dengan PNG Evidence Card.
2. **`solshield-cdp`** — menyediakan remote Chromium WebSocket untuk web **`sol-shield.xyz/buildcheck`** di Vercel agar tidak perlu langganan Browserless berbayar.

Langkah di VPS:
```bash
git clone https://github.com/Blanksite/solshield.git
cd solshield
bash worker/setup-vps.sh

cp .env.example .env
nano .env
```

Isi minimal di `.env` VPS:
- `VENICE_API_KEY=...`
- `SOLANA_RPC_URL=...`
- `GITHUB_TOKEN=...`
- `CDP_AUTH_TOKEN=<buat_string_acak_panjang_32_karakter>`
- `X_BEARER_TOKEN=...`, `X_API_KEY=...`, `X_API_SECRET=...`, `X_ACCESS_TOKEN=...`, `X_ACCESS_SECRET=...`
- Uji dulu `BOT_DRY_RUN=true` → kalau log sudah clean, ubah jadi `BOT_DRY_RUN=false` agar bot mulai balas mention live.

Jalankan permanen dengan PM2:
```bash
pm2 start worker/ecosystem.config.cjs
pm2 save
pm2 startup
```

### (Opsional) Ekspos `solshield-cdp` via HTTPS (`wss://`) untuk Vercel
Vercel perlu URL `wss://` (HTTPS WebSocket). Jika memakai subdomain `cdp.sol-shield.xyz` yang diarahkan DNS ke IP VPS, pasang Caddy di VPS:
```caddyfile
cdp.sol-shield.xyz {
    reverse_proxy 127.0.0.1:3001
}
```
Lalu di **Vercel Environment Variables** project `solshield`, tambahkan:
- `VENICE_API_KEY=...`
- `SOLANA_RPC_URL=...`
- `GITHUB_TOKEN=...`
- `BUILDCHECK_BROWSER_WS_ENDPOINT=wss://cdp.sol-shield.xyz?token=YOUR_CDP_AUTH_TOKEN`

Terakhir jalankan deploy web ke Vercel saat sudah siap:
```bash
npx vercel --prod
```
