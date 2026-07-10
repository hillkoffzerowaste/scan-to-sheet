# Marketplace Sync Worker

Local Playwright worker for syncing Seller Center order data into Firestore.

Supported platforms:
- TikTok Shop Seller Center
- Shopee Seller Centre
- Lazada Seller Center

The worker runs on the shop PC, keeps separate browser profiles per platform, and syncs every 5 minutes by default.

## Setup

1. Download a Firebase service account JSON from Firebase Console > Project settings > Service accounts.
2. Save it locally as `firebase-service-account.json` in the project root. This file is gitignored.
3. Copy config:

```powershell
Copy-Item scripts\marketplace-sync\config.example.json scripts\marketplace-sync\config.json
```

4. Login each platform once:

```powershell
npm run marketplace:login -- tiktok
npm run marketplace:login -- shopee
npm run marketplace:login -- lazada
```

Keep the opened browser signed in, then close it after the session is saved.

5. Test one sync:

```powershell
npm run marketplace:sync:once
```

6. Start continuous sync:

```powershell
npm run marketplace:sync
```

## Windows Autostart

Run PowerShell as the current Windows user:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\marketplace-sync\windows\install-autostart.ps1
```

This creates a Task Scheduler task named `ScanToSheet Marketplace Sync` that starts on logon.

## Local Dashboard

Start the local dashboard:

```powershell
npm run marketplace:dashboard
```

Then open:

```txt
http://127.0.0.1:8787
```

Or use the Windows launcher:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\marketplace-sync\windows\open-dashboard.ps1
```

The dashboard can open login browsers, run one sync, start the 5-minute worker, stop it, and show recent logs.

## Firestore Data

Orders are upserted into `marketplaceOrders` with document id:

```txt
{platform}__{orderId}
```

If `orderId` is missing, the worker uses tracking number.

Sync status is written to:

```txt
syncStatus/{platform}
```

The worker also uses `syncLocks/{platform}` so multiple installed shop PCs do not sync the same platform at the same time.

## Selector Tuning

The first extractor is intentionally conservative and regex-based. It will not fake data. If a seller center page changes or hides data behind a detail modal, the worker will save a screenshot under `screenshots/` and report zero orders. Use that screenshot to tune `platforms.js`.

## Security

Do not commit `firebase-service-account.json`, `config.json`, browser profiles, logs, or screenshots. They are ignored by git.
