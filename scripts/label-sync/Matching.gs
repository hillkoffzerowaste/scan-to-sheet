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

    // Every result carries its own labelKey. `uniqueLabels` collapses duplicates and drops
    // labels with neither platform nor order id, so results is shorter than the caller's
    // label array — pairing them back up by array index silently attributes one label's
    // outcome to a different label, and the tail logs 'missing_match_result'.
    normalized.labels.forEach(function (label) {
      var labelKey = key(label.platform, label.orderId);
      function record(status, matchedRows, errorCode) {
        results.push({
          labelKey: labelKey,
          status: status,
          matchedRows: matchedRows,
          errorCode: errorCode,
        });
      }

      if (normalized.conflicts[labelKey]) {
        record('ambiguous', 0, 'conflicting_label_data');
        return;
      }

      // 1. Try tracking-first if tracking ID exists
      var candidates = findCandidatesByTracking(index, label);
      if (candidates.length) {
        candidates.forEach(function (candidate) {
          updates.push({ sheetName: candidate.sheetName, rowNumber: candidate.rowNumber, value: label.combined });
        });
        record('updated', candidates.length, '');
        return;
      }

      // 2. Fallback to order ID matching
      var orderResult = findCandidatesByOrderId(index, label);
      if (orderResult.status === 'ok') {
        orderResult.candidates.forEach(function (candidate) {
          updates.push({ sheetName: candidate.sheetName, rowNumber: candidate.rowNumber, value: label.combined });
        });
        record('updated', orderResult.candidates.length, '');
        return;
      }
      // Anything that is not 'ok' still gets a result, so a label can never fall out of the
      // set without an explanation attached to its key.
      record(
        orderResult.status === 'ambiguous' ? 'ambiguous' : 'unmatched',
        0,
        orderResult.errorCode || 'order_not_found',
      );
    });
    return { updates: updates, results: results };
  }

  /**
   * Pair a caller's original label list back to the outcomes above. Labels that
   * `uniqueLabels` merged share one outcome; labels it dropped report why.
   */
  function resultsByLabel(labels, results) {
    var byKey = {};
    (results || []).forEach(function (result) { byKey[result.labelKey] = result; });
    return (labels || []).map(function (label) {
      var labelKey = key(label.platform, label.orderId);
      if (!labelKey || labelKey === '|') {
        return { label: label, status: 'skipped', matchedRows: 0, errorCode: 'incomplete_label' };
      }
      var result = byKey[labelKey];
      if (!result) {
        return { label: label, status: 'error', matchedRows: 0, errorCode: 'missing_match_result' };
      }
      return { label: label, status: result.status, matchedRows: result.matchedRows, errorCode: result.errorCode };
    });
  }

  return {
    buildOrderIndex: buildOrderIndex,
    matchLabels: matchLabels,
    resultsByLabel: resultsByLabel,
    normalizeOrderId: normalizeOrderId,
    normalizePlatform: normalizePlatform,
  };
})();
