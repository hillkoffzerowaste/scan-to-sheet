export const STAFF_POSITIONS = ["leader", "checker", "packer"];

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

export function buildDutyLabelsByStaff(assignments, dutyById) {
  const labelsByStaff = new Map();
  for (const assignment of assignments) {
    const dutyName = dutyById.get(assignment.dutyTypeId)?.name || "ประเภทงานเดิม";
    const note = String(assignment.note ?? "").trim();
    const label = note ? `${dutyName} — ${note}` : dutyName;
    const labels = labelsByStaff.get(assignment.staffId) ?? [];
    labels.push(label);
    labelsByStaff.set(assignment.staffId, labels);
  }
  return labelsByStaff;
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
