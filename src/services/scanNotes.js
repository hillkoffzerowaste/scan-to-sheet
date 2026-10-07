export function mergeScanNotes(...values) {
  const notes = [];
  for (const value of values) {
    for (const note of String(value ?? '').split('|').map((item) => item.trim()).filter(Boolean)) {
      if (!notes.includes(note)) notes.push(note);
    }
  }
  return notes.join(' | ');
}
