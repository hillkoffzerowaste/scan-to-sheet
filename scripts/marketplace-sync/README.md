# Marketplace Sync Worker

Local Playwright worker for syncing Seller Center order data into Firestore.

Supported platforms:
- TikTok Shop Seller Center
- Shopee Seller Centre
- Lazada Seller Center

The worker runs on the shop PC using one dedicated Chromium profile shared by every platform, and syncs every 5 minutes by default. It always runs sequentially because the shared profile must never be opened by concurrent workers.

## Setup

1. Download a Firebase service account JSON from Firebase Console > Project settings > Service accounts.
2. Save it locally as `firebase-service-account.json` in the project root. This file is gitignored.
3. Copy config:

```powershell
Copy-Item scripts\marketplace-sync\config.example.json scripts\marketplace-sync\config.json
```

4. Login each platform once. To open all three Seller Centers as tabs in one Chromium window:

```powershell
npm run marketplace:login -- all
```

Or open one platform at a time:

```powershell
npm run marketplace:login -- tiktok
npm run marketplace:login -- shopee
npm run marketplace:login -- lazada
```

Complete each login, then close the Chromium window after the sessions are saved.

All platforms share `scripts/marketplace-sync/marketplace-profile` by default. This is a dedicated Chromium profile for the worker, not the user's normal Chrome profile.
The login command opens the order page first, so an existing saved session should stay logged in.
If it asks for login again, make sure no other worker/login window for the same platform is open and the profile folder was not deleted.

5. Test one sync:

```powershell
npm run marketplace:sync:once
```

6. Start continuous sync:

```powershell
npm run marketplace:sync
```

Do not run two sync workers or a login window while the worker is running. The Firestore global lock prevents concurrent access to the shared profile.

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

The worker uses `syncLocks/marketplace-worker` with a unique run token so two workers, including on the same PC, cannot use the shared profile at the same time.

Sync status values are `running`, `synced`, `partial`, `login_required`, and `error`. `partial` means no orders were extracted although a login page was not detected; the worker saves a screenshot for review. `login_required` means the session needs a manual login.

## Selector Tuning

The extractor is intentionally conservative and text-driven. It tries to recover `orderId`, `trackingNo`, `buyerName`, `status`, `courier`, and basic `items[].name/sku` only when those values are visible on the page. It will not invent fields.

If a seller center page changes or hides data behind a detail modal, the worker will save a screenshot under `screenshots/` and report zero or partial orders. Use that screenshot to tune `platforms.js`.

## Security

Do not commit `firebase-service-account.json`, `config.json`, browser profiles, logs, or screenshots. They are ignored by git.
