var MARKETPLACE_ORDERS = {
  sheetName: 'Marketplace Orders',
  headers: [
    'Order Key', 'Normalized Tracking', 'Tracking', 'Platform', 'Order ID',
    'SKUs JSON', 'Items JSON', 'Source Rows', 'Seller Status', 'Expected Ship At',
    'Ordered At', 'Updated At',
  ],
};

/**
 * Creates a low-frequency integrity trigger in the same Apps Script project as Label Sync.
 * The web app writes uploads with the signed-in operator's Google Sheets permission; no web
 * endpoint or client-side shared secret is used. This job only repairs accidental duplicate
 * rows left by a browser retry or simultaneous uploads.
 */
function setupMarketplaceOrderMaintenance() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'runMarketplaceOrderMaintenance') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('runMarketplaceOrderMaintenance').timeBased().everyHours(1).create();
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

    sheet.getRange(1, 1, 1, MARKETPLACE_ORDERS.headers.length).setValues([MARKETPLACE_ORDERS.headers]);
    var lastRow = sheet.getLastRow();
    if (lastRow < 3) return { rows: Math.max(0, lastRow - 1), duplicatesRemoved: 0 };

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
    removals.sort(function (left, right) { return right - left; }).forEach(function (rowNumber) {
      sheet.deleteRow(rowNumber);
    });
    return { rows: values.length, duplicatesRemoved: removals.length };
  } finally {
    lock.releaseLock();
  }
}
