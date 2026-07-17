export async function parseXlsxArrayBuffer(arrayBuffer) {
  const XLSX = await import('@e965/xlsx');
  const workbook = XLSX.read(new Uint8Array(arrayBuffer), {
    type: 'array',
    cellDates: false,
    raw: false,
  });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const worksheet = workbook.Sheets[firstSheetName];
  if (!worksheet) return [];
  return XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: true,
    blankrows: false,
  }).map((row) => row.map((cell) => cell ?? ''));
}
