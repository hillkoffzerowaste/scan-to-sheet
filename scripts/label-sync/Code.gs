var LABEL_SYNC = {
  logSheetName: 'Label Sync Log',
  defaultLookbackDays: 7,
  defaultFileLookbackDays: 30,
  statePropertyKey: 'LABEL_SYNC_STATE_V1',
};

function setupLabelSync() {
  var config = getLabelSyncConfig_();
  var spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  ensureLogSheet_(spreadsheet, config.logSheetName);

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'runLabelSync') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('runLabelSync').timeBased().everyMinutes(15).create();
}

function runLabelSync() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { skipped: true, reason: 'lock_unavailable' };

  var summary = { filesScanned: 0, labelsFound: 0, rowsUpdated: 0, errors: 0 };
  try {
    var config = getLabelSyncConfig_();
    var spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
    var logSheet = ensureLogSheet_(spreadsheet, config.logSheetName);
    var state = readProcessedState_();
    var oldestFileDate = new Date(Date.now() - config.fileLookbackDays * 24 * 60 * 60 * 1000);
    var files = listCandidateFiles_(config.folderId, oldestFileDate);
    var sheetRows = getTargetDateSheets_(spreadsheet, config.lookbackDays).map(function (sheet) {
      var lastRow = sheet.getLastRow();
      return {
        sheetName: sheet.getName(),
        values: lastRow < 2 ? [] : sheet.getRange(2, 13, lastRow - 1, 4).getValues(),
      };
    });
    var logRows = [];

    files.forEach(function (file) {
      var fileId = file.getId();
      var modifiedAt = file.getLastUpdated().toISOString();
      if (state.files[fileId] === modifiedAt) return;
      summary.filesScanned += 1;

      try {
        var text = extractFileText_(file, config.ocrLanguage);
        var labels = LabelParser.parseLabels(text, file.getName());
        summary.labelsFound += labels.length;
        if (!labels.length) {
          logRows.push(logRow_(file, '', '', 'ocr_empty', 0, 'no_complete_label'));
          state.files[fileId] = modifiedAt;
          return;
        }

        var result = LabelMatching.matchLabels(sheetRows, labels);
        summary.rowsUpdated += applyLabelUpdates_(spreadsheet, result.updates);
        labels.forEach(function (label, index) {
          var outcome = result.results[index] || { status: 'error', matchedRows: 0, errorCode: 'missing_match_result' };
          logRows.push(logRow_(file, label.platform, label.orderId, outcome.status, outcome.matchedRows, outcome.errorCode));
        });
        state.files[fileId] = modifiedAt;
      } catch (error) {
        summary.errors += 1;
        logRows.push(logRow_(file, '', '', 'error', 0, String(error && error.message || error).slice(0, 200)));
      }
    });

    appendLogRows_(logSheet, logRows);
    writeProcessedState_(state);
    return summary;
  } finally {
    lock.releaseLock();
  }
}

function getLabelSyncConfig_() {
  var properties = PropertiesService.getScriptProperties();
  var folderId = properties.getProperty('LABEL_FOLDER_ID');
  var spreadsheetId = properties.getProperty('SPREADSHEET_ID');
  if (!folderId || !spreadsheetId) {
    throw new Error('Set LABEL_FOLDER_ID and SPREADSHEET_ID in Script Properties before running Label Sync.');
  }
  return {
    folderId: folderId,
    spreadsheetId: spreadsheetId,
    lookbackDays: positiveInteger_(properties.getProperty('LOOKBACK_DAYS'), LABEL_SYNC.defaultLookbackDays),
    fileLookbackDays: positiveInteger_(properties.getProperty('FILE_LOOKBACK_DAYS'), LABEL_SYNC.defaultFileLookbackDays),
    logSheetName: properties.getProperty('LOG_SHEET_NAME') || LABEL_SYNC.logSheetName,
    ocrLanguage: properties.getProperty('OCR_LANGUAGE') || 'th',
  };
}

function positiveInteger_(value, fallback) {
  var number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function listCandidateFiles_(rootFolderId, oldestFileDate) {
  var found = [];
  var seenFolders = {};
  function visit(folder) {
    if (seenFolders[folder.getId()]) return;
    seenFolders[folder.getId()] = true;
    var files = folder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      if (file.getLastUpdated() < oldestFileDate || !isSupportedLabelFile_(file)) continue;
      found.push(file);
    }
    var folders = folder.getFolders();
    while (folders.hasNext()) visit(folders.next());
  }
  visit(DriveApp.getFolderById(rootFolderId));
  return found;
}

function isSupportedLabelFile_(file) {
  var mimeType = file.getMimeType();
  return mimeType === MimeType.PDF
    || mimeType === MimeType.JPEG
    || mimeType === MimeType.PNG
    || mimeType === 'image/jpg';
}

function extractFileText_(file, ocrLanguage) {
  var temporaryDoc = Drive.Files.create(
    {
      name: 'Label OCR - ' + file.getName() + ' - ' + Date.now(),
      mimeType: MimeType.GOOGLE_DOCS,
    },
    file.getBlob(),
    { ocrLanguage: ocrLanguage, fields: 'id', supportsAllDrives: true },
  );
  try {
    var lastError = null;
    for (var attempt = 0; attempt < 4; attempt += 1) {
      try {
        var text = DocumentApp.openById(temporaryDoc.id).getBody().getText();
        if (text) return text;
      } catch (error) {
        lastError = error;
      }
      Utilities.sleep(800 * (attempt + 1));
    }
    if (lastError) throw lastError;
    return '';
  } finally {
    if (temporaryDoc && temporaryDoc.id) Drive.Files.remove(temporaryDoc.id);
  }
}

function getTargetDateSheets_(spreadsheet, lookbackDays) {
  return spreadsheet.getSheets()
    .filter(function (sheet) { return !sheet.isSheetHidden() && /^\d{4}-\d{2}-\d{2}$/.test(sheet.getName()); })
    .sort(function (left, right) { return right.getName().localeCompare(left.getName()); })
    .slice(0, lookbackDays);
}

function applyLabelUpdates_(spreadsheet, updates) {
  var bySheetAndValue = {};
  updates.forEach(function (update) {
    var groupKey = update.sheetName + '\u0000' + update.value;
    (bySheetAndValue[groupKey] = bySheetAndValue[groupKey] || []).push(update.rowNumber);
  });
  Object.keys(bySheetAndValue).forEach(function (groupKey) {
    var parts = groupKey.split('\u0000');
    var sheetName = parts[0];
    var value = parts.slice(1).join('\u0000');
    var rowNumbers = bySheetAndValue[groupKey];
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) return;
    sheet.getRangeList(rowNumbers.map(function (rn) { return 'P' + rn; })).setValue(value);
  });
  return updates.length;
}

function ensureLogSheet_(spreadsheet, name) {
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 8).setValues([[
      'Run At', 'File ID', 'File Name', 'Platform', 'Order ID', 'Status', 'Matched Rows', 'Error Code',
    ]]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function logRow_(file, platform, orderId, status, matchedRows, errorCode) {
  return [
    new Date(), file.getId(), file.getName(), platform || '', orderId || '', status,
    matchedRows || 0, errorCode || '',
  ];
}

function appendLogRows_(sheet, rows) {
  if (!rows.length) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
}

function readProcessedState_() {
  var raw = PropertiesService.getScriptProperties().getProperty(LABEL_SYNC.statePropertyKey);
  try {
    var parsed = raw ? JSON.parse(raw) : {};
    return { files: parsed.files || {} };
  } catch (_) {
    return { files: {} };
  }
}

function writeProcessedState_(state) {
  var entries = Object.entries(state.files || {}).sort(function (left, right) {
    return String(right[1]).localeCompare(String(left[1]));
  }).slice(0, 500);
  var files = {};
  entries.forEach(function (entry) { files[entry[0]] = entry[1]; });
  PropertiesService.getScriptProperties().setProperty(LABEL_SYNC.statePropertyKey, JSON.stringify({ files: files }));
}
