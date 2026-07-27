var LabelParser = (function () {
  function normalizeLabelText(text) {
    return String(text || '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFEFF]/g, '')
      .replace(/[\uF700-\uF7FF]/g, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .trim();
  }

  function normalizeOrderId(platform, value) {
    return String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  function normalizePlatform(value) {
    var text = String(value || '').toLowerCase();
    if (text.indexOf('shopee') !== -1) return 'shopee';
    if (text.indexOf('lazada') !== -1 || text.indexOf('lex') !== -1) return 'lazada';
    if (text.indexOf('tiktok') !== -1 || text.indexOf('tik tok') !== -1) return 'tiktok';
    return '';
  }

  function cleanValue(value) {
    return String(value || '')
      .replace(/\(?\+?66\)?\s*\d[\d* -]{6,}/g, '')
      .replace(/\b(?:Phone(?: number)?|โทรศัพท์)\s*:?\s*/gi, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .replace(/[|]+/g, ' ')
      .trim();
  }

  function linesBetween(text, startPattern, endPattern) {
    var start = text.search(startPattern);
    if (start === -1) return '';
    var tail = text.slice(start).replace(startPattern, '');
    var end = endPattern ? tail.search(endPattern) : -1;
    return end === -1 ? tail : tail.slice(0, end);
  }

  function formatRecipient(name, address) {
    var cleanName = cleanValue(name);
    var cleanAddress = cleanValue(address);
    return cleanName && cleanAddress ? cleanName + ' | ' + cleanAddress : '';
  }

  function makeLabel(platform, orderId, name, address) {
    var normalizedOrderId = normalizeOrderId(platform, orderId);
    var recipientName = cleanValue(name);
    var recipientAddress = cleanValue(address);
    var combined = formatRecipient(recipientName, recipientAddress);
    if (!normalizedOrderId || !recipientName || !recipientAddress || !combined) return null;
    return {
      platform: platform,
      orderId: normalizedOrderId,
      recipientName: recipientName,
      address: recipientAddress,
      combined: combined,
    };
  }

  function parseShopeeLabels(text) {
    var orderPattern = /Shopee\s+Order\s+No\.?[ \t]*([A-Z0-9_-]+)/gi;
    var matches = [];
    var match;
    while ((match = orderPattern.exec(text))) {
      matches.push({ index: match.index, end: orderPattern.lastIndex, orderId: match[1] });
    }

    return matches.map(function (order, index) {
      var previousEnd = index === 0 ? 0 : matches[index - 1].end;
      var nextStart = index === matches.length - 1 ? text.length : matches[index + 1].index;
      var previousSegment = text.slice(previousEnd, order.index);
      var followingSegment = text.slice(order.index, nextStart);
      var segment = /(?:PICKUP\s+DATE|SHIP\s+BY\s+DATE)/i.test(followingSegment)
        ? followingSegment
        : previousSegment;
      var recipientBlock = linesBetween(segment, /ผู้รับ\s*\(\s*TO\s*\)\s*/i, /Shopee\s+Order\s+No\.|PICKUP\s+DATE|SHIP\s+BY\s+DATE/i);
      if (!recipientBlock) {
        recipientBlock = linesBetween(segment, /\(\s*TO\s*\)\s*/i, /Shopee\s+Order\s+No\.|PICKUP\s+DATE|SHIP\s+BY\s+DATE/i);
      }
      if (!recipientBlock) return null;

      var noteIndex = recipientBlock.search(/\bNOTE\b/i);
      var fromIndex = recipientBlock.search(/\(\s*FROM\s*\)/i);
      if (fromIndex !== -1 && noteIndex !== -1 && fromIndex < noteIndex) {
        var recipientNameLines = recipientBlock.slice(0, noteIndex)
          .split('\n')
          .map(cleanValue)
          .filter(function (line) {
            return line &&
              !/\(\s*FROM\s*\)/i.test(line) &&
              !/^(?:เลขที่|thailand|ประเทศไทย|hillkoff|home|pickup|ship by)/i.test(line);
          });
        var recipientAddress = recipientBlock.slice(noteIndex).replace(/^\s*NOTE\s*/i, '');
        recipientAddress = recipientAddress.split(/\n(?:HILLKOFF|BULKY|TOTAL|จำนวนรวม|#)/i)[0];
        return makeLabel('shopee', order.orderId, recipientNameLines[0], recipientAddress);
      }

      var lines = recipientBlock.split('\n').map(cleanValue).filter(Boolean);
      if (!lines.length) return null;
      var name = lines[0];
      var address = lines.slice(1).join(' ');
      return makeLabel('shopee', order.orderId, name, address);
    }).filter(Boolean);
  }

  function parseLazadaLabels(text) {
    var orderMatch = /Order\s+No\.?\s*:\s*([A-Z0-9_-]+)/i.exec(text);
    var nameMatch = /Customer\s+NAME\s*:\s*([^\n]+)/i.exec(text);
    var address = linesBetween(text, /(?:ที่อยู่\s*)?ADDRESS\s*:\s*/i, /(?:Phone\s+number|เบอร์โทรศัพท์|Seller\s+Name)\s*:/i);
    var label = makeLabel('lazada', orderMatch && orderMatch[1], nameMatch && nameMatch[1], address);
    return label ? [label] : [];
  }

  function parseTikTokLabels(text) {
    var orderMatch = /Order\s+ID\s*:\s*([A-Z0-9_-]+)/i.exec(text);
    var recipientBlock = linesBetween(text, /(?:^|\n)ถึง\s*/m, /PICK-?UP|Order\s+ID\s*:/i);
    if (!recipientBlock) return [];
    var lines = recipientBlock.split('\n').map(cleanValue).filter(Boolean);
    var meaningfulLines = lines.filter(function (line) {
      return !/\(?\+?66\)?\s*\d[\d* -]{6,}/.test(line);
    });
    if (meaningfulLines.length < 2) return [];
    var label = makeLabel('tiktok', orderMatch && orderMatch[1], meaningfulLines[0], meaningfulLines.slice(1).join(' '));
    return label ? [label] : [];
  }

  function parseLabels(text, fileName) {
    var normalizedText = normalizeLabelText(text);
    var platform = normalizePlatform(fileName + '\n' + normalizedText);
    if (platform === 'shopee') return parseShopeeLabels(normalizedText);
    if (platform === 'lazada') return parseLazadaLabels(normalizedText);
    if (platform === 'tiktok') return parseTikTokLabels(normalizedText);

    var labels = parseShopeeLabels(normalizedText);
    if (labels.length) return labels;
    labels = parseLazadaLabels(normalizedText);
    return labels.length ? labels : parseTikTokLabels(normalizedText);
  }

  return {
    cleanValue: cleanValue,
    formatRecipient: formatRecipient,
    normalizeLabelText: normalizeLabelText,
    normalizeOrderId: normalizeOrderId,
    normalizePlatform: normalizePlatform,
    parseLabels: parseLabels,
  };
})();
