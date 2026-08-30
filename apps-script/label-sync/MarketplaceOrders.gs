var MARKETPLACE_ORDERS = {
  sheetName: 'Marketplace Orders',
  headers: [
    'Order Key', 'Normalized Tracking', 'Tracking', 'Platform', 'Order ID',
    'SKUs JSON', 'Items JSON', 'Source Rows', 'Seller Status', 'Expected Ship At',
    'Ordered At', 'Updated At',
  ],
  recentScanSheetCount: 2,
};

/**
 * Creates the durable Marketplace cleanup queue in the same Apps Script project as Label Sync.
 * The web app writes uploads with the signed-in operator's Google Sheets permission; no web
 * endpoint or client-side shared secret is used. This job only repairs accidental duplicate
 * rows left by a browser retry or simultaneous uploads.
 */
function setupMarketplaceOrderMaintenance() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'runMarketplaceOrderMaintenance') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('runMarketplaceOrderMaintenance').timeBased().everyMinutes(5).create();
}

function runMarketplaceOrderMaintenance() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { skipped: true, reason: 'lock_unavailable' };
  try {
    var properties = PropertiesService.getScriptProperties();
    var spreadsheetId = properties.getProperty('SPREADSHEET_ID');
    if (!spreadsheetId) throw new Error('Set SPREADSHEET_ID in Script Properties before running Marketplace maintenance.');
    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    var sheet = spreadsheet.getSheetByName(MARKETPLACE_ORDERS.sheetName);
    if (!sheet) return { skipped: true, reason: 'sheet_not_created_yet' };

    var existingHeaders = sheet.getRange(1, 1, 1, MARKETPLACE_ORDERS.headers.length).getDisplayValues()[0];
    if (existingHeaders.join('\u0000') !== MARKETPLACE_ORDERS.headers.join('\u0000')) {
      sheet.getRange(1, 1, 1, MARKETPLACE_ORDERS.headers.length).setValues([MARKETPLACE_ORDERS.headers]);
    }
    var lastRow = sheet.getLastRow();
    if (lastRow < 3) return { rows: Math.max(0, lastRow - 1), duplicatesRemoved: 0, matchedRemoved: 0 };

    var values = sheet.getRange(2, 1, lastRow - 1, MARKETPLACE_ORDERS.headers.length).getDisplayValues();
    var keepByKey = {};
    values.forEach(function (row, index) {
      var key = String(row[0] || '').trim();
      if (!key) return;
      var previous = keepByKey[key];
      // ISO timestamps sort lexically. On a legacy blank timestamp, keep the lower row so
      // the cleanup stays deterministic and never discards a newer known value by guessing.
      if (!previous || String(row[11] || '') > String(previous.updatedAt || '')) {
        keepByKey[key] = { rowNumber: index + 2, updatedAt: row[11] };
      }
    });

    var removals = [];
    values.forEach(function (row, index) {
      var key = String(row[0] || '').trim();
      if (key && keepByKey[key] && keepByKey[key].rowNumber !== index + 2) removals.push(index + 2);
    });
    deleteMarketplaceRows_(sheet, removals);

    // The web app guarantees the scan row exists before this job runs. Looking only at the
    // newest date tabs covers normal scans and the midnight crossover without rereading an
    // ever-growing history every five minutes.
    lastRow = sheet.getLastRow();
    if (lastRow < 3) return { rows: 0, duplicatesRemoved: removals.length, matchedRemoved: 0 };
    values = sheet.getRange(2, 1, lastRow - 1, MARKETPLACE_ORDERS.headers.length).getDisplayValues();
    var scannedTracking = recentScannedMarketplaceTracking_(spreadsheet);
    var matchedRows = values.reduce(function (rows, row, index) {
      var tracking = normalizeMarketplaceTracking_(row[1] || row[2]);
      if (tracking && scannedTracking[tracking]) rows.push(index + 2);
      return rows;
    }, []);
    deleteMarketplaceRows_(sheet, matchedRows);
    return { rows: values.length, duplicatesRemoved: removals.length, matchedRemoved: matchedRows.length };
  } finally {
    lock.releaseLock();
  }
}

function recentScannedMarketplaceTracking_(spreadsheet) {
  var scanned = {};
  spreadsheet.getSheets()
    .filter(function (sheet) { return /^\d{4}-\d{2}-\d{2}$/.test(sheet.getName()); })
    .sort(function (left, right) { return right.getName().localeCompare(left.getName()); })
    .slice(0, MARKETPLACE_ORDERS.recentScanSheetCount)
    .forEach(function (sheet) {
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return;
      // F is Packer Tracking and M is Admin Tracking. Either one is a completed match.
      sheet.getRange(2, 6, lastRow - 1, 8).getDisplayValues().forEach(function (row) {
        [row[0], row[7]].forEach(function (value) {
          var tracking = normalizeMarketplaceTracking_(value);
          if (tracking) scanned[tracking] = true;
        });
      });
    });
  return scanned;
}

function normalizeMarketplaceTracking_(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function deleteMarketplaceRows_(sheet, rows) {
  var sorted = rows.slice().sort(function (left, right) { return right - left; });
  while (sorted.length) {
    var end = sorted.shift();
    var start = end;
    while (sorted.length && sorted[0] === start - 1) start = sorted.shift();
    sheet.deleteRows(start, end - start + 1);
  }
}
