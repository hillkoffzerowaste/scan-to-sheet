var LABEL_SYNC = {
  logSheetName: 'Label Sync Log',
  defaultLookbackDays: 7,
  defaultFileLookbackDays: 30,
  statePropertyKey: 'LABEL_SYNC_STATE_V1',
  // A label often reaches Drive before the order row exists, and OCR sometimes returns
  // nothing on the first pass. Both used to be recorded as "processed", so the file was
  // never looked at again unless someone edited it. Retry those with a widening backoff
  // and give up only after maxRetryAttempts, so OCR is not re-run forever either.
  maxRetryAttempts: 6,
  firstRetryMinutes: 15,
  maxRetryMinutes: 24 * 60,
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

  var summary = {
    filesScanned: 0,
    filesSkipped: 0,
    filesRetryScheduled: 0,
    labelsFound: 0,
    rowsUpdated: 0,
    errors: 0,
  };
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
        values: lastRow < 2 ? [] : sheet.getRange(2, 13, lastRow - 1, 4).getDisplayValues(),
      };
    });
    var logRows = [];

    var nowMs = Date.now();

    files.forEach(function (file) {
      var fileId = file.getId();
      var modifiedAt = file.getLastUpdated().toISOString();
      var entry = fileStateEntry_(state.files[fileId]);
      if (!shouldProcessFile_(entry, modifiedAt, nowMs)) {
        summary.filesSkipped += 1;
        return;
      }
      summary.filesScanned += 1;

      try {
        var text = extractFileText_(file, config.ocrLanguage);
        var labels = LabelParser.parseLabels(text, file.getName());
        summary.labelsFound += labels.length;
        if (!labels.length) {
          logRows.push(logRow_(file, '', '', 'ocr_empty', 0, 'no_complete_label'));
          state.files[fileId] = nextFileState_(entry, { modifiedAt: modifiedAt, outcome: 'retry', nowMs: nowMs });
          summary.filesRetryScheduled += 1;
          return;
        }

        var result = LabelMatching.matchLabels(sheetRows, labels);
        summary.rowsUpdated += applyLabelUpdates_(spreadsheet, result.updates);
        // Pair outcomes back to labels by key. `matchLabels` dedupes and drops incomplete
        // labels, so its results array does not line up with `labels` positionally.
        var outcomes = LabelMatching.resultsByLabel(labels, result.results);
        outcomes.forEach(function (outcome) {
          logRows.push(logRow_(
            file,
            outcome.label.platform,
            outcome.label.orderId,
            outcome.status,
            outcome.matchedRows,
            outcome.errorCode,
          ));
        });

        var fileOutcome = summarizeFileOutcome_(outcomes);
        state.files[fileId] = nextFileState_(entry, { modifiedAt: modifiedAt, outcome: fileOutcome, nowMs: nowMs });
        if (fileOutcome === 'retry') summary.filesRetryScheduled += 1;
      } catch (error) {
        summary.errors += 1;
        logRows.push(logRow_(file, '', '', 'error', 0, String(error && error.message || error).slice(0, 200)));
        // A thrown error (OCR quota, Drive hiccup) is transient by nature — schedule it
        // rather than leaving the file untracked and re-OCR'd on every single run.
        state.files[fileId] = nextFileState_(entry, { modifiedAt: modifiedAt, outcome: 'retry', nowMs: nowMs });
        summary.filesRetryScheduled += 1;
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

/**
 * Normalize one stored file entry. V1 stored a bare modifiedAt string, so anything left
 * over from before the retry support is read as an already-finished file.
 */
function fileStateEntry_(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    return { modifiedAt: value, status: 'done', attempts: 0, nextRetryAt: 0 };
  }
  return {
    modifiedAt: String(value.modifiedAt || ''),
    status: value.status || 'done',
    attempts: Number(value.attempts) || 0,
    nextRetryAt: Number(value.nextRetryAt) || 0,
  };
}

/**
 * A file is worth (re)reading when it is new, when Drive says it changed since the last
 * look, or when a scheduled retry has come due and the attempt budget is not spent.
 */
function shouldProcessFile_(entry, modifiedAt, nowMs) {
  if (!entry) return true;
  if (entry.modifiedAt !== modifiedAt) return true;
  if (entry.status === 'done') return false;
  if (entry.attempts >= LABEL_SYNC.maxRetryAttempts) return false;
  return nowMs >= entry.nextRetryAt;
}

/**
 * A file is finished only when every label it produced landed on a row. One unmatched or
 * ambiguous label is enough to keep the whole file in the retry queue, because the order
 * row it needs may simply not have been scanned yet.
 */
function summarizeFileOutcome_(outcomes) {
  if (!outcomes || !outcomes.length) return 'retry';
  for (var index = 0; index < outcomes.length; index += 1) {
    if (outcomes[index].status !== 'updated') return 'retry';
  }
  return 'done';
}

function nextFileState_(entry, options) {
  var previous = entry || { modifiedAt: '', status: 'done', attempts: 0, nextRetryAt: 0 };
  // A modified file is a fresh case: give it the full attempt budget again.
  var sameFile = previous.modifiedAt === options.modifiedAt;
  if (options.outcome === 'done') {
    return { modifiedAt: options.modifiedAt, status: 'done', attempts: 0, nextRetryAt: 0 };
  }

  var attempts = (sameFile ? previous.attempts : 0) + 1;
  var backoffMinutes = Math.min(
    LABEL_SYNC.firstRetryMinutes * Math.pow(2, attempts - 1),
    LABEL_SYNC.maxRetryMinutes,
  );
  return {
    modifiedAt: options.modifiedAt,
    status: attempts >= LABEL_SYNC.maxRetryAttempts ? 'gave_up' : 'retry',
    attempts: attempts,
    nextRetryAt: options.nowMs + (backoffMinutes * 60 * 1000),
  };
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
    var leftEntry = fileStateEntry_(left[1]);
    var rightEntry = fileStateEntry_(right[1]);
    return String(rightEntry.modifiedAt).localeCompare(String(leftEntry.modifiedAt));
  }).slice(0, 500);
  var files = {};
  entries.forEach(function (entry) { files[entry[0]] = entry[1]; });
  PropertiesService.getScriptProperties().setProperty(LABEL_SYNC.statePropertyKey, JSON.stringify({ files: files }));
}
