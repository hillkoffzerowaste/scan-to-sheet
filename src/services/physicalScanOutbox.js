const STORAGE_KEY = 'scan-to-sheet:physical-scan-attempts:v1';

function outboxError(code, message, detail) {
  return Object.assign(new Error(message), { code, detail });
}

export function createPhysicalScanOutbox(storage, locks = globalThis.window?.navigator?.locks) {
  async function mutate(action) {
    return locks?.request ? locks.request(STORAGE_KEY, action) : action();
  }
  function read() {
    try {
      const items = JSON.parse((storage ?? globalThis.localStorage).getItem(STORAGE_KEY) ?? '[]');
      if (!Array.isArray(items) || items.some(item => !item?.id || !item.context?.attempt?.actorUid)) throw new Error('Invalid outbox');
      return items;
    } catch (error) {
      throw outboxError('SCAN_OUTBOX_READ_FAILED', 'อ่านรายการสแกนรอยืนยันไม่ได้ กรุณาให้ผู้ดูแลตรวจสอบก่อนสแกนต่อ', error);
    }
  }
  function write(items) {
    try {
      (storage ?? globalThis.localStorage).setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (error) {
      throw outboxError('SCAN_OUTBOX_WRITE_FAILED', 'บันทึกรายการสแกนลงเครื่องไม่ได้ กรุณาตรวจสอบพื้นที่จัดเก็บก่อนสแกนต่อ', error);
    }
  }
  return {
    list: (actorUid) => read().filter(item => item.context.attempt.actorUid === actorUid),
    add: (job) => mutate(() => {
      const items = read();
      if (items.some(item => item.id === job.id)) throw outboxError('SCAN_ATTEMPT_EXISTS', 'รายการสแกนนี้อยู่ในคิวแล้ว');
      if (items.length >= 100) throw outboxError('SCAN_OUTBOX_FULL', 'มีรายการรอยืนยันครบ 100 รายการ กรุณารอให้ยืนยันสำเร็จก่อนสแกนต่อ');
      write([...items, job]);
    }),
    acknowledge: (id) => mutate(() => write(read().filter(item => item.id !== id))),
  };
}
