import {
  MIME_SHEET,
  SHEETS_API,
  apiFetch,
  columnLetter,
  createDriveItem,
  escapeSheetName,
  findDriveItem,
  getSpreadsheet,
} from './googleSheets.js';
import {
  PACKING_VIDEO_SHEET_HEADERS,
  PACKING_VIDEO_SHEET_NAME,
  buildPackingVideoSheetRow,
} from './packingVideoModel.js';

/**
 * The packing-video log lives in its own spreadsheet, beside the scan master rather than
 * inside it: the two have different column counts and different lifecycles, and the user asked
 * for a separate book.
 *
 * One flat tab, not a tab per day. The dashboard searches across dates, and per-day tabs are
 * the source of the "column C must match the sheet name" trap this project already carries in
 * the scan sheet. There is no such coupling here.
 */
export const PACKING_SHEET_FILE_NAME = 'Scan to Sheet Packing Videos';

/**
 * Runs a Google call, retrying once against a refreshed access token.
 *
 * `apiFetch` deliberately knows nothing about refreshing, which is fine for the scan flow
 * where every call follows a user action. The upload queue runs in the background for a whole
 * shift, so it meets expired tokens routinely — without this, every clip uploaded after the
 * hour mark would sit at sheetStatus 'pending' with nothing visibly wrong.
 */
export async function withFreshToken(run, { getToken, refreshToken }) {
  try {
    return await run(await getToken());
  } catch (error) {
    if (error?.status !== 401 || typeof refreshToken !== 'function') throw error;
    const refreshed = await refreshToken();
    if (!refreshed) throw error;
    return run(refreshed);
  }
}

const preparedWorksheets = new Set();
const lastColumn = columnLetter(PACKING_VIDEO_SHEET_HEADERS.length);

function requireConfig(config) {
  const folderId = config?.folder?.id;
  if (!folderId) {
    throw Object.assign(new Error('ยังไม่ได้เชื่อมต่อ Google Drive'), {
      code: 'PACKING_VIDEO_SHEET_NO_FOLDER',
    });
  }
  return folderId;
}

/**
 * Finds or creates the spreadsheet, reusing the same discover-then-create dance as
 * `prepareGoogleSheets`. The id is returned for the caller to fold into the existing Google
 * config object, which already round-trips to localStorage and to Vercel KV.
 */
export async function preparePackingVideoSheet({ token, config }) {
  const parentId = requireConfig(config);
  const existing =
    (await findDriveItem({ token, name: PACKING_SHEET_FILE_NAME, mimeType: MIME_SHEET, parentId }))
    ?? (await findDriveItem({ token, name: PACKING_SHEET_FILE_NAME, mimeType: MIME_SHEET }));
  if (existing) return existing;

  return createDriveItem({ token, name: PACKING_SHEET_FILE_NAME, mimeType: MIME_SHEET, parentId });
}

/** Adds the tab and its header row once per session, mirroring `ensureWorksheetReady`. */
export async function ensurePackingVideoWorksheet({ token, spreadsheetId }) {
  if (preparedWorksheets.has(spreadsheetId)) return;

  const spreadsheet = await getSpreadsheet(token, spreadsheetId);
  const sheets = spreadsheet.sheets ?? [];
  const existing = sheets.find((sheet) => sheet.properties.title === PACKING_VIDEO_SHEET_NAME);

  if (!existing) {
    // A brand-new spreadsheet arrives with one default tab; rename it rather than leaving an
    // empty "Sheet1" beside the real data.
    const request = sheets.length === 1 && !/^\d{4}-\d{2}-\d{2}$/.test(sheets[0].properties.title)
      ? {
        updateSheetProperties: {
          properties: { sheetId: sheets[0].properties.sheetId, title: PACKING_VIDEO_SHEET_NAME },
          fields: 'title',
        },
      }
      : { addSheet: { properties: { title: PACKING_VIDEO_SHEET_NAME } } };

    try {
      await apiFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, token, {
        method: 'POST',
        body: JSON.stringify({ requests: [request] }),
      });
    } catch (error) {
      // Two benches preparing at once is fine; the tab only needs to exist.
      if (!/already exists|duplicate/i.test(String(error?.detail ?? error?.message ?? ''))) throw error;
    }
  }

  await apiFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${escapeSheetName(PACKING_VIDEO_SHEET_NAME)}!A1:${lastColumn}1`)}?valueInputOption=RAW`,
    token,
    { method: 'PUT', body: JSON.stringify({ values: [PACKING_VIDEO_SHEET_HEADERS] }) },
  );

  preparedWorksheets.add(spreadsheetId);
}

/**
 * Appends one row.
 *
 * Unlike the scan sheet this uses `values:append` and takes no write lock. The scan sheet
 * needs its `_TEMP_` placeholder dance because it computes running sequence numbers from the
 * row's position, so two machines must not calculate the same row. Nothing here is derived
 * from position — all fourteen values are known before the call, and the attempt number comes
 * from a Firestore transaction. `append` is atomic server-side, so concurrent benches simply
 * land on different rows, and there is no placeholder left behind if the call fails.
 */
export async function appendPackingVideoRow({ token, spreadsheetId, doc }) {
  await ensurePackingVideoWorksheet({ token, spreadsheetId });

  const range = `${escapeSheetName(PACKING_VIDEO_SHEET_NAME)}!A:${lastColumn}`;
  const response = await apiFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}:append`
      + '?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
    token,
    { method: 'POST', body: JSON.stringify({ values: [buildPackingVideoSheetRow(doc)] }) },
  );

  return { rowNumber: parseAppendedRowNumber(response?.updates?.updatedRange) };
}

export function parseAppendedRowNumber(updatedRange) {
  const match = /![A-Z]+(\d+)/.exec(String(updatedRange ?? ''));
  return match ? Number(match[1]) : 0;
}

/** Fills in the Drive link once the worker has moved the file. */
export async function updatePackingVideoDriveUrl({ token, spreadsheetId, rowNumber, driveUrl }) {
  if (!rowNumber) {
    throw Object.assign(new Error('ไม่ทราบแถวในชีตของวิดีโอนี้'), {
      code: 'PACKING_VIDEO_SHEET_ROW_UNKNOWN',
    });
  }
  const driveColumn = columnLetter(PACKING_VIDEO_SHEET_HEADERS.indexOf('Drive URL') + 1);
  const range = `${escapeSheetName(PACKING_VIDEO_SHEET_NAME)}!${driveColumn}${rowNumber}`;
  await apiFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    token,
    { method: 'PUT', body: JSON.stringify({ values: [[driveUrl]] }) },
  );
}
