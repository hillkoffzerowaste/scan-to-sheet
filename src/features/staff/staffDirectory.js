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
  const packers = staff
    .filter((person) => person.active !== false && person.position === "packer")
    .sort(byOrder)
    .map((person) => String(person.nickname ?? "").trim())
    .filter(Boolean);
  const normalized = packers.map((name) => name.toLocaleLowerCase("th"));
  if (new Set(normalized).size !== normalized.length) {
    const error = new Error("ชื่อเล่น Packer ซ้ำกัน");
    error.code = "STAFF_DUPLICATE_PACKER_NICKNAME";
    throw error;
  }
  return packers;
}

export function validateStaffInput(person) {
  const errors = [];
  if (!String(person.fullName ?? "").trim()) errors.push("fullName");
  if (!String(person.nickname ?? "").trim()) errors.push("nickname");
  if (!STAFF_POSITIONS.includes(person.position)) errors.push("position");
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
