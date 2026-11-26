# Clubs'Night Fullstack

Frontend: Vite (Cloudflare Pages `clubsnight-id`). Backend: Cloudflare Worker `backend/worker.js` (D1 `clubsnight-db-v2`, R2 `BUCKET`). Login API: Elixir di Render (`backend/lib`).

## Cek lokal
    npm ci && npm run build && npm run check && node --test backend/tests/*.test.js

## Nama env (hanya nama, jangan simpan nilainya di git)
- Worker: ADMIN_SECRET_TOKEN, WORKER_ASSERTION_SECRET, OWNER_TELEGRAM_IDS, ADMIN_QC_TELEGRAM_IDS, R2_PUBLIC_URL, ELIXIR_API_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID, TELEGRAM_WEBHOOK_SECRET, SAWERIA_WEBHOOK_TOKEN
- Render: WORKER_ASSERTION_SECRET, FRONTEND_ORIGIN, OWNER_TELEGRAM_IDS, OWNER_CN_IDS, ADMIN_QC_TELEGRAM_IDS, ADMIN_MERCH_TELEGRAM_IDS, TELEGRAM_BOT_TOKEN
- Pages: VITE_API_URL, VITE_ELIXIR_API_URL, VITE_LIVECHAT_URL, VITE_MEDIA_URL

## Urutan deploy
1. Backup: `cd backend && npx wrangler d1 export clubsnight-db-v2 --remote --output ~/backups/cn-$(date +%Y%m%d-%H%M).sql`
2. Migrasi: `npx wrangler d1 migrations apply clubsnight-db-v2 --remote`
3. Render: deploy otomatis dari `main`
4. Worker: `npx wrangler deploy --keep-vars`
5. Pages: merge ke `main`

## Rollback
- Worker: `cd backend && npx wrangler rollback`
- Pages: Dashboard > clubsnight-id > Deployments > Rollback
- Render: Dashboard > Deploys > Rollback
