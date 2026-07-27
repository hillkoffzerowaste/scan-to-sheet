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
    var trackingScoped = {};
    var trackingUnscoped = {};
    sheetRows.forEach(function (sheet) {
      (sheet.values || []).forEach(function (row, index) {
        var trackingId = normalizeOrderId(row[0] || '');
        var platform = normalizePlatform(row[1]);
        var orderId = normalizeOrderId(row[2]);
        if (!orderId && !trackingId) return;
        var candidate = { sheetName: sheet.sheetName, rowNumber: index + 2, platform: platform, orderId: orderId, trackingId: trackingId };
        if (orderId) {
          var orderKey = '|' + orderId;
          (unscoped[orderKey] = unscoped[orderKey] || []).push(candidate);
          if (platform) {
            var scopedKey = key(platform, orderId);
            (scoped[scopedKey] = scoped[scopedKey] || []).push(candidate);
          }
        }
        if (trackingId) {
          var tOrderKey = '|' + trackingId;
          (trackingUnscoped[tOrderKey] = trackingUnscoped[tOrderKey] || []).push(candidate);
          if (platform) {
            var tScopedKey = key(platform, trackingId);
            (trackingScoped[tScopedKey] = trackingScoped[tScopedKey] || []).push(candidate);
          }
        }
      });
    });
    return { scoped: scoped, unscoped: unscoped, trackingScoped: trackingScoped, trackingUnscoped: trackingUnscoped };
  }

  function findCandidatesByTracking(index, label) {
    if (!label.trackingId) return [];
    var labelKey = key(label.platform, label.trackingId);
    var candidates = index.trackingScoped[labelKey] || [];
    if (!candidates.length) {
      var fallback = index.trackingUnscoped['|' + label.trackingId] || [];
      if (fallback.length === 1 && !fallback[0].platform) candidates = fallback;
    }
    return candidates;
  }

  function findCandidatesByOrderId(index, label) {
    var labelKey = key(label.platform, label.orderId);
    var candidates = index.scoped[labelKey] || [];
    if (!candidates.length) {
      var fallback = index.unscoped['|' + normalizeOrderId(label.orderId)] || [];
      if (fallback.length === 1 && !fallback[0].platform) candidates = fallback;
      else if (fallback.length > 1) return { candidates: fallback, status: 'ambiguous', errorCode: 'multiple_unscoped_rows' };
    }
    if (!candidates.length) return { candidates: [], status: 'unmatched', errorCode: 'order_not_found' };
    return { candidates: candidates, status: 'ok' };
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

      // 1. Try tracking-first if tracking ID exists
      var candidates = findCandidatesByTracking(index, label);
      if (candidates.length) {
        candidates.forEach(function (candidate) {
          updates.push({ sheetName: candidate.sheetName, rowNumber: candidate.rowNumber, value: label.combined });
        });
        results.push({ status: 'updated', matchedRows: candidates.length, errorCode: '' });
        return;
      }

      // 2. Fallback to order ID matching
      var orderResult = findCandidatesByOrderId(index, label);
      if (orderResult.status === 'ok') {
        orderResult.candidates.forEach(function (candidate) {
          updates.push({ sheetName: candidate.sheetName, rowNumber: candidate.rowNumber, value: label.combined });
        });
        results.push({ status: 'updated', matchedRows: orderResult.candidates.length, errorCode: '' });
        return;
      }
      if (orderResult.status === 'ambiguous' || orderResult.status === 'unmatched') {
        results.push({ status: orderResult.status, matchedRows: 0, errorCode: orderResult.errorCode });
        return;
      }
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
