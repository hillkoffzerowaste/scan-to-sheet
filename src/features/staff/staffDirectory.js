export const STAFF_POSITIONS = ["leader", "checker", "packer"];
export const DEFAULT_PACKING_NOTICE = `• รักษาความสะอาดและจัดอุปกรณ์เข้าที่หลังใช้งาน
• ตรวจสินค้า จำนวน และใบปะหน้าก่อนปิดกล่องทุกครั้ง
• ปฏิบัติงานตามโซนและหน้าที่ประจำวันที่ได้รับมอบหมาย
• พบสินค้าหรือข้อมูลผิดปกติให้แจ้งหัวหน้าทันที
• ห้ามวางสินค้าและอุปกรณ์กีดขวางทางเดิน
• ก่อนเลิกงานให้ตรวจพื้นที่และส่งมอบงานที่ยังค้าง`;

export function resolvePackingNotice(value) {
  return String(value ?? "").trim() || DEFAULT_PACKING_NOTICE;
}

function byOrder(a, b) {
  return (
    Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) ||
    String(a.nickname ?? a.fullName ?? "").localeCompare(
      String(b.nickname ?? b.fullName ?? ""),
      "th"
    )
  );
}

export function groupActiveStaff(staff) {
  const groups = { leader: [], checker: [], packer: [] };
  for (const person of staff) {
    if (person.active !== false && groups[person.position])
      groups[person.position].push(person);
  }
  STAFF_POSITIONS.forEach((position) => groups[position].sort(byOrder));
  return groups;
}

export function buildPackingRoomTeam(groups) {
  return [...(groups.checker ?? []), ...(groups.packer ?? [])];
}

export function resolveDailyStatus(staffId, statuses) {
  return statuses.get(staffId) || "working";
}

export function buildWorkforceSummary(staff, statuses, duties) {
  const active = staff.filter((person) => person.active !== false);
  const summary = {
    total: active.length,
    working: 0,
    leave: 0,
    off: 0,
    outside: 0,
    unassigned: 0,
  };
  active.forEach((person) => {
    const status = resolveDailyStatus(person.id, statuses);
    if (status in summary) summary[status] += 1;
    if (!(duties.get(person.id) ?? []).length) summary.unassigned += 1;
  });
  return summary;
}

export function maskStaffContact(value, type) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (type === "phone") {
    const digits = text.replace(/\D/g, "");
    if (digits.length < 7) return `${digits.slice(0, 2)}***`;
    return `${digits.slice(0, 3)}-xxx-${digits.slice(-4)}`;
  }
  if (type === "email") {
    const [name, domain] = text.split("@");
    if (!domain) return `${text.slice(0, 2)}***`;
    return `${name.slice(0, 2)}***@${domain}`;
  }
  return text.length <= 4
    ? `${text.slice(0, 1)}***`
    : `${text.slice(0, 2)}***${text.slice(-2)}`;
}

export function filterDirectoryStaff(staff, options) {
  const needle = String(options.query ?? "").trim().toLocaleLowerCase("th");
  return staff.filter((person) => {
    const status = resolveDailyStatus(person.id, options.statuses);
    const dutyLabels = options.duties.get(person.id) ?? [];
    if (options.position !== "all" && person.position !== options.position)
      return false;
    if (options.status !== "all" && status !== options.status) return false;
    if (options.duty === "assigned" && !dutyLabels.length) return false;
    if (options.duty === "unassigned" && dutyLabels.length) return false;
    return (
      !needle ||
      [
        person.fullName,
        person.employeeId,
        person.nickname,
        person.phone,
        person.lineId,
        person.email,
        person.position,
        ...dutyLabels,
      ].some((value) =>
        String(value ?? "").toLocaleLowerCase("th").includes(needle)
      )
    );
  });
}

export function staffMissingFields(person, dutyLabels) {
  const missing = [];
  if (!person.photoUrl) missing.push("รูป");
  if (!person.fullName || !person.employeeId) missing.push("ข้อมูลประจำตัว");
  if (!person.phone && !person.lineId && !person.email)
    missing.push("ข้อมูลติดต่อ");
  if (!dutyLabels.length) missing.push("หน้าที่วันนี้");
  return missing;
}

export function reorderStaffWithinPosition(staff, draggedId, targetId) {
  const dragged = staff.find((person) => person.id === draggedId);
  const target = staff.find((person) => person.id === targetId);
  if (!dragged || !target || dragged.position !== target.position) return staff;
  const positionItems = staff.filter(
    (person) => person.position === dragged.position
  );
  const fromIndex = positionItems.findIndex((person) => person.id === draggedId);
  const toIndex = positionItems.findIndex((person) => person.id === targetId);
  const reordered = [...positionItems];
  reordered.splice(toIndex, 0, reordered.splice(fromIndex, 1)[0]);
  let index = 0;
  return staff.map((person) =>
    person.position === dragged.position
      ? { ...reordered[index], sortOrder: index++ }
      : person
  );
}

export function buildPackerOptions(staff) {
  const groups = groupActiveStaff(staff);
  const packers = STAFF_POSITIONS.flatMap((position) => groups[position])
    .map((person) => String(person.nickname ?? "").trim())
    .filter(Boolean);
  const normalized = packers.map((name) => name.toLocaleLowerCase("th"));
  if (new Set(normalized).size !== normalized.length) {
    const error = new Error("ชื่อเล่นผู้แพ็คซ้ำกัน");
    error.code = "STAFF_DUPLICATE_PACKER_NICKNAME";
    throw error;
  }
  return packers;
}

export function validateStaffInput(person, existingStaff = []) {
  const errors = [];
  if (!String(person.fullName ?? "").trim()) errors.push("fullName");
  if (!String(person.nickname ?? "").trim()) errors.push("nickname");
  if (!STAFF_POSITIONS.includes(person.position)) errors.push("position");
  const employeeId = String(person.employeeId ?? "")
    .trim()
    .toLocaleLowerCase("th");
  if (
    employeeId &&
    existingStaff.some(
      (item) =>
        item.id !== person.id &&
        String(item.employeeId ?? "")
          .trim()
          .toLocaleLowerCase("th") === employeeId
    )
  )
    errors.push("employeeId");
  return errors;
}

export function copyAssignments(assignments, date) {
  return assignments.map((assignment) => ({ ...assignment, date }));
}

export function mergeAssignments(existing, copied) {
  const keys = new Set(
    existing.map((item) => `${item.staffId}__${item.dutyTypeId}`)
  );
  return copied.filter((item) => {
    const key = `${item.staffId}__${item.dutyTypeId}`;
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

export function buildDailyReportText({
  dateLabel,
  summary,
  leaderName,
  assistantName,
  staff,
  statuses,
  dutyLabelsByStaff,
  positionLabels,
  statusLabels,
  notice,
}) {
  const staffLines = staff
    .filter((person) => person.active !== false)
    .map((person, index) => {
      const status = resolveDailyStatus(person.id, statuses);
      const duties = dutyLabelsByStaff.get(person.id) ?? [];
      return `${index + 1}. ${person.fullName} (${person.nickname}) — ${
        positionLabels[person.position] ?? person.position
      } — ${statusLabels[status] ?? status} — ${
        duties.join("; ") || "ยังไม่ได้กำหนดหน้าที่"
      }`;
    });

  return [
    "รายงานสรุปการทำงานประจำวัน ห้องแพ็คสินค้า",
    `วันที่ ${dateLabel}`,
    "",
    `สรุป: ทั้งหมด ${summary.total} คน | ปฏิบัติงาน ${summary.working} | ลา ${summary.leave} | หยุด ${summary.off} | ออกนอกพื้นที่ ${summary.outside} | ยังไม่มีหน้าที่ ${summary.unassigned}`,
    `หัวหน้า: ${leaderName || "ยังไม่กำหนด"}`,
    `ผู้ช่วยหัวหน้า: ${assistantName || "ยังไม่กำหนด"}`,
    "",
    "รายชื่อและหน้าที่",
    ...staffLines,
    "",
    "ประกาศและกฎระเบียบห้องแพ็ค",
    String(notice ?? "").trim() || "ไม่มีประกาศ",
  ].join("\n");
}

export function staffSaveErrorMessage(error) {
  const code = String(error?.code ?? "");
  if (code === "STAFF_DUPLICATE_EMPLOYEE_ID")
    return "รหัสพนักงานนี้ถูกใช้งานแล้ว";
  if (code === "STAFF_EMPLOYEE_ID_TOO_LONG")
    return "รหัสพนักงานต้องยาวไม่เกิน 60 ตัวอักษร";
  if (code === "STAFF_DUPLICATE_PACKER_NICKNAME")
    return "ชื่อเล่นผู้แพ็คซ้ำกัน";
  if (code.includes("storage/unauthorized"))
    return "ไม่มีสิทธิ์อัปโหลดรูปพนักงาน กรุณาเข้าสู่ระบบใหม่";
  if (code.includes("permission-denied"))
    return "ไม่มีสิทธิ์บันทึกข้อมูลพนักงาน กรุณาเข้าสู่ระบบใหม่";
  if (code.includes("storage/quota-exceeded"))
    return "พื้นที่จัดเก็บรูปไม่พร้อมใช้งาน กรุณาแจ้ง Admin";
  return "บันทึกข้อมูลพนักงานไม่สำเร็จ กรุณาลองใหม่";
}
