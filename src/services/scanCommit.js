export async function commitFallbackScan({ appendToSheet, mirrorToFirestore }) {
  const sheetResult = await appendToSheet();

  try {
    await mirrorToFirestore(sheetResult);
    return sheetResult;
  } catch {
    return {
      ...sheetResult,
      status: 'firestore_unconfirmed',
      message: 'บันทึก Google Sheet แล้ว แต่ยังยืนยัน Firestore ไม่สำเร็จ',
    };
  }
}
