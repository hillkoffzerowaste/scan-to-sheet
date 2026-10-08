const SHIFTED_DIGITS = {
  Digit0: ')',
  Digit1: '!',
  Digit2: '@',
  Digit3: '#',
  Digit4: '$',
  Digit5: '%',
  Digit6: '^',
  Digit7: '&',
  Digit8: '*',
  Digit9: '(',
};

const PUNCTUATION = {
  Backquote: ['`', '~'],
  Minus: ['-', '_'],
  Equal: ['=', '+'],
  BracketLeft: ['[', '{'],
  BracketRight: [']', '}'],
  Backslash: ['\\', '|'],
  Semicolon: [';', ':'],
  Quote: ["'", '"'],
  Comma: [',', '<'],
  Period: ['.', '>'],
  Slash: ['/', '?'],
};

const NUMPAD_PUNCTUATION = {
  NumpadAdd: '+',
  NumpadSubtract: '-',
  NumpadMultiply: '*',
  NumpadDivide: '/',
  NumpadDecimal: '.',
};

// Windows/Chrome can expose a Thai Kedmanee character instead of the physical US key
// when a keyboard-wedge scanner sends a QR. Keep this inverse map as a last-resort
// fallback for browsers that report `code: "Unidentified"` or mark the event composing.
const THAI_KEYBOARD_TO_ASCII = new Map([
  ['+', '!'], ['.', '"'], ['๒', '#'], ['๓', '$'], ['๔', '%'], ['฿', '&'], ['ง', "'"],
  ['๖', '('], ['๗', ')'], ['๕', '*'], ['๙', '+'], ['ม', ','], ['ข', '-'], ['ใ', '.'], ['ฝ', '/'],
  ['จ', '0'], ['ๅ', '1'], ['/', '2'], ['-', '3'], ['ภ', '4'], ['ถ', '5'], ['ุ', '6'], ['ึ', '7'],
  ['ค', '8'], ['ต', '9'], ['ซ', ':'], ['ว', ';'], ['ฒ', '<'], ['ช', '='], ['ฬ', '>'], ['ฦ', '?'],
  ['๑', '@'], ['ฤ', 'A'], ['ฺ', 'B'], ['ฉ', 'C'], ['ฏ', 'D'], ['ฎ', 'E'], ['โ', 'F'], ['ฌ', 'G'],
  ['็', 'H'], ['ณ', 'I'], ['๋', 'J'], ['ษ', 'K'], ['ศ', 'L'], ['?', 'M'], ['์', 'N'], ['ฯ', 'O'],
  ['ญ', 'P'], ['๐', 'Q'], ['ฑ', 'R'], ['ฆ', 'S'], ['ธ', 'T'], ['๊', 'U'], ['ฮ', 'V'], ['"', 'W'],
  [')', 'X'], ['ํ', 'Y'], ['(', 'Z'], ['บ', '['], ['ฃ', '\\'], ['ล', ']'], ['ู', '^'], ['๘', '_'],
  ['_', '`'], ['ฟ', 'a'], ['ิ', 'b'], ['แ', 'c'], ['ก', 'd'], ['ำ', 'e'], ['ด', 'f'], ['เ', 'g'],
  ['้', 'h'], ['ร', 'i'], ['่', 'j'], ['า', 'k'], ['ส', 'l'], ['ท', 'm'], ['ื', 'n'], ['น', 'o'],
  ['ย', 'p'], ['ๆ', 'q'], ['พ', 'r'], ['ห', 's'], ['ะ', 't'], ['ี', 'u'], ['อ', 'v'], ['ไ', 'w'],
  ['ป', 'x'], ['ั', 'y'], ['ผ', 'z'], ['ฐ', '{'], ['ฅ', '|'], [',', '}'], ['%', '~'],
]);

const RECOVERED_SCANNER_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:/%._-]{2,}$/;

function thaiKeyboardCharacter(value) {
  if (typeof value !== 'string' || !/[\u0E00-\u0E7F]/u.test(value)) return null;
  return THAI_KEYBOARD_TO_ASCII.get(value) ?? null;
}

export function barcodeCharacterFromKeyEvent(event) {
  if (!event || event.ctrlKey || event.altKey || event.metaKey) return null;
  if (event.isComposing && !event.key) return null;

  // On some Chrome/Windows combinations the scanner's Thai-layout key keeps its
  // shifted character but loses `shiftKey`. Prefer the actual Thai character in
  // that case; using only the physical code would turn QR command capitals into
  // lowercase and make the Packer QR unresolvable.
  const mappedThaiCharacter = thaiKeyboardCharacter(event.key);
  if (mappedThaiCharacter && /^[A-Za-z]$/.test(mappedThaiCharacter)) {
    return event.shiftKey ? mappedThaiCharacter.toUpperCase() : mappedThaiCharacter;
  }
  if (mappedThaiCharacter && !event.shiftKey) return mappedThaiCharacter;

  if (/^Key[A-Z]$/.test(event.code)) {
    // Keep the scanner's original case for case-sensitive QR payloads such as Firestore staff
    // IDs. When the active OS layout returns Thai, reconstruct the US key using Shift instead.
    if (/^[a-zA-Z]$/.test(event.key ?? '')) return event.key;
    const letter = event.code.slice(3);
    return event.shiftKey ? letter : letter.toLowerCase();
  }
  if (/^Digit[0-9]$/.test(event.code)) {
    return event.shiftKey ? SHIFTED_DIGITS[event.code] : event.code.slice(5);
  }
  if (/^Numpad[0-9]$/.test(event.code)) return event.code.slice(6);

  const punctuation = PUNCTUATION[event.code];
  if (punctuation) return punctuation[event.shiftKey ? 1 : 0];
  return NUMPAD_PUNCTUATION[event.code] ?? THAI_KEYBOARD_TO_ASCII.get(event.key) ?? null;
}

export function recoverThaiKeyboardText(value) {
  const raw = String(value ?? '');
  if (!/[\u0E00-\u0E7F]/u.test(raw)) return raw;
  let changed = false;
  const recovered = [...raw].map((character) => {
    const mapped = THAI_KEYBOARD_TO_ASCII.get(character);
    if (mapped === undefined) return character;
    changed = true;
    return mapped;
  }).join('');
  return changed ? recovered : raw;
}

export function chooseBarcodeSubmissionValue({
  physicalValue = '',
  rawValue = '',
  isRecognizedSpecialValue = () => false,
} = {}) {
  const physical = String(physicalValue ?? '').trim();
  const raw = String(rawValue ?? '').trim();
  if (raw && raw !== physical && isRecognizedSpecialValue(raw)) return raw;
  const recovered = recoverThaiKeyboardText(raw).trim();
  if (recovered && recovered !== raw && isRecognizedSpecialValue(recovered)) return recovered;
  if (recovered && recovered !== raw && RECOVERED_SCANNER_VALUE_PATTERN.test(recovered)) return recovered;
  return physical || raw;
}
