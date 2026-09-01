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

export function barcodeCharacterFromKeyEvent(event) {
  if (!event || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return null;

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
  return NUMPAD_PUNCTUATION[event.code] ?? null;
}
