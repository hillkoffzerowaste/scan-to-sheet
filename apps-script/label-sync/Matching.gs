var LabelMatching = (function () {
  function normalizePlatform(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeOrderId(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function key(platform, orderId) {
    return normalizePlatform(platform) + '|' + normalizeOrderId(orderId);
  }

  function buildOrderIndex(sheetRows) {
    var scoped = {};
    var unscoped = {};
    sheetRows.forEach(function (sheet) {
      (sheet.values || []).forEach(function (row, index) {
        var platform = normalizePlatform(row[0]);
        var orderId = normalizeOrderId(row[1]);
        if (!orderId) return;
        var candidate = { sheetName: sheet.sheetName, rowNumber: index + 2, platform: platform, orderId: orderId };
        var orderKey = '|' + orderId;
        (unscoped[orderKey] = unscoped[orderKey] || []).push(candidate);
        if (platform) {
          var scopedKey = key(platform, orderId);
          (scoped[scopedKey] = scoped[scopedKey] || []).push(candidate);
        }
      });
    });
    return { scoped: scoped, unscoped: unscoped };
  }

  function uniqueLabels(labels) {
    var byKey = {};
    var conflicts = {};
    (labels || []).forEach(function (label) {
      var labelKey = key(label.platform, label.orderId);
      if (!labelKey || labelKey === '|') return;
      if (byKey[labelKey] && byKey[labelKey].combined !== label.combined) conflicts[labelKey] = true;
      byKey[labelKey] = byKey[labelKey] || label;
    });
    return { labels: Object.keys(byKey).map(function (labelKey) { return byKey[labelKey]; }), conflicts: conflicts };
  }

  function matchLabels(sheetRows, labels) {
    var index = buildOrderIndex(sheetRows);
    var normalized = uniqueLabels(labels);
    var updates = [];
    var results = [];

    normalized.labels.forEach(function (label) {
      var labelKey = key(label.platform, label.orderId);
      if (normalized.conflicts[labelKey]) {
        results.push({ status: 'ambiguous', matchedRows: 0, errorCode: 'conflicting_label_data' });
        return;
      }
      var candidates = index.scoped[labelKey] || [];
      if (!candidates.length) {
        var fallback = index.unscoped['|' + normalizeOrderId(label.orderId)] || [];
        if (fallback.length === 1 && !fallback[0].platform) candidates = fallback;
        else if (fallback.length > 1) {
          results.push({ status: 'ambiguous', matchedRows: 0, errorCode: 'multiple_unscoped_rows' });
          return;
        }
      }
      if (!candidates.length) {
        results.push({ status: 'unmatched', matchedRows: 0, errorCode: 'order_not_found' });
        return;
      }
      candidates.forEach(function (candidate) {
        updates.push({ sheetName: candidate.sheetName, rowNumber: candidate.rowNumber, value: label.combined });
      });
      results.push({ status: 'updated', matchedRows: candidates.length, errorCode: '' });
    });
    return { updates: updates, results: results };
  }

  return {
    buildOrderIndex: buildOrderIndex,
    matchLabels: matchLabels,
    normalizeOrderId: normalizeOrderId,
    normalizePlatform: normalizePlatform,
  };
})();
