# Label Sync Apps Script

This standalone Apps Script job reads parcel labels from a Google Drive folder every 15 minutes. It matches the parsed platform and Order ID against columns N and O of date tabs, then overwrites column P with:

```text
recipient name | recipient address
```

The same project also maintains the `Marketplace Orders` tab that the web app uses as its
order catalogue. Seller Center files are parsed in the browser and written directly to that
tab using the operator's Google OAuth session; this avoids Firestore reads/writes and does
not expose an Apps Script web-app secret in the browser. `MarketplaceOrders.gs` removes only
duplicate catalogue rows left by retries. It never edits scan rows or recipient addresses.

The script writes no recipient address to its `Label Sync Log` audit tab.

## Install

1. Create a standalone Apps Script project at [script.google.com](https://script.google.com/create).
2. Add `Code.gs`, `LabelParser.gs`, `Matching.gs`, and `MarketplaceOrders.gs` from this folder. Replace the default manifest with `appsscript.json`.
3. In Apps Script, add the **Drive API** advanced service. The manifest already declares Drive API v3; if the script uses a standard Google Cloud project, enable Google Drive API in that Cloud project too.
4. In **Project Settings > Script properties**, add these values:

| Property | Value |
| --- | --- |
| `LABEL_FOLDER_ID` | Google Drive folder ID that contains the label PDFs/images |
| `SPREADSHEET_ID` | Destination Google Sheet ID |
| `LOOKBACK_DAYS` | `7` by default; number of latest visible date tabs to search |
| `FILE_LOOKBACK_DAYS` | `30` by default; only scan recently modified files |
| `LOG_SHEET_NAME` | Optional; defaults to `Label Sync Log` |
| `OCR_LANGUAGE` | Optional; defaults to `th` |

5. Run `setupLabelSync` once from the editor, approve the requested permissions, and verify that the trigger exists in **Triggers**.
6. Run `runLabelSync` manually once. Check the `Label Sync Log` tab for updated, unmatched, ambiguous, OCR-empty, or error outcomes.

## Marketplace Orders maintenance

1. Keep the same `SPREADSHEET_ID` Script Property used by Label Sync.
2. Upload one Seller Center CSV/XLSX from the web app. It creates the `Marketplace Orders` tab automatically.
3. Run `setupMarketplaceOrderMaintenance` once and approve permissions. The hourly trigger is intentionally low-frequency because ordinary imports are already idempotent and happen through the signed-in web app.
4. Optionally run `runMarketplaceOrderMaintenance` manually; it only removes duplicate rows with the same Order Key, retaining the newest `Updated At` value.

## Behaviour and safeguards

- Supports PDF, JPEG, and PNG recursively under the configured Drive folder.
- Creates a temporary Google Doc to extract/OCR text, then deletes that temporary document in `finally`.
- Uses `LockService` to prevent overlapping 15-minute runs.
- A file is skipped only when its file ID and modified time were processed successfully. Change a file to make it eligible again.
- If the Sheet has multiple rows for one matching `platform + Order ID`, every matching P cell receives the same value.
- If an order is ambiguous across blank platform rows or conflicting labels disagree, it is logged and not written.
- Column P formatting is intentionally preserved. Long combined addresses may be visible on cell selection or in the formula bar because adjacent columns contain product data.

## First production check

Before enabling the trigger, use `runLabelSync` manually and verify a few matched rows in column P. The source PDFs can have different reading orders after OCR; any `ocr_empty` or `unmatched` outcome should be reviewed in the log before changing parser rules.
