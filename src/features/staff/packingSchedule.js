/* Fixed weekly roster (เวรประจำ) plus per-day changes.

   The weekly table is the source of truth: every weekday carries the same duties week after
   week. A per-day change only swaps who covers one duty on one date — it never rewrites the
   table, so tomorrow still follows the schedule. Ad-hoc daily assignments stay on top as
   extra work outside the table. */

export const WEEKDAYS = [
  { value: 1, label: "จันทร์", short: "จ." },
  { value: 2, label: "อังคาร", short: "อ." },
  { value: 3, label: "พุธ", short: "พ." },
  { value: 4, label: "พฤหัสบดี", short: "พฤ." },
  { value: 5, label: "ศุกร์", short: "ศ." },
  { value: 6, label: "เสาร์", short: "ส." },
  { value: 0, label: "อาทิตย์", short: "อา." },
];

const WEEKDAY_BY_VALUE = new Map(WEEKDAYS.map((item) => [item.value, item]));

export function isWeekdayValue(value) {
  return Number.isInteger(value) && value >= 0 && value <= 6;
}

export function weekdayLabel(value) {
  return WEEKDAY_BY_VALUE.get(Number(value))?.label ?? "";
}

export function weekdayFromDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey ?? ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // The key is already a Bangkok calendar date, so it is read as-is. Turning it into an instant
  // first is the 7-hour offset bug AGENTS.md records.
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(utc.getTime()) || utc.getUTCMonth() !== month - 1) return null;
  return utc.getUTCDay();
}

export function overrideDocId(dateKey, weeklyDutyId) {
  return `${dateKey}__${weeklyDutyId}`;
}

function dutyOrder(dutyById, dutyTypeId) {
  return Number(dutyById.get(dutyTypeId)?.sortOrder ?? 0);
}

function dutyName(dutyById, dutyTypeId) {
  return dutyById.get(dutyTypeId)?.name || "ประเภทงานเดิม";
}

function byDuty(a, b) {
  return (
    a.dutySortOrder - b.dutySortOrder ||
    a.dutyName.localeCompare(b.dutyName, "th") ||
    a.key.localeCompare(b.key)
  );
}

export function resolveDayDuties({
  dateKey,
  weeklyDuties = [],
  overrides = [],
  dailyAssignments = [],
  dutyById = new Map(),
}) {
  const weekday = weekdayFromDateKey(dateKey);
  // A change belongs to one date only. Filtering here — not just in the query — keeps a stale
  // load from an earlier date out of the roster while the new date is still loading.
  const overrideByDutyId = new Map(
    overrides
      .filter((item) => !item.date || item.date === dateKey)
      .map((item) => [String(item.weeklyDutyId ?? ""), item])
  );
  const scheduled = weeklyDuties
    .filter((duty) => Number(duty.weekday) === weekday)
    .map((duty) => {
      const override = overrideByDutyId.get(String(duty.id));
      const baseStaffId = String(duty.staffId ?? "");
      const staffId = override ? String(override.staffId ?? "") : baseStaffId;
      return {
        key: `weekly-${duty.id}`,
        source: "weekly",
        weeklyDutyId: duty.id,
        assignmentId: "",
        overrideId: override?.id ?? "",
        dutyTypeId: duty.dutyTypeId,
        dutyName: dutyName(dutyById, duty.dutyTypeId),
        dutySortOrder: dutyOrder(dutyById, duty.dutyTypeId),
        weekday,
        baseStaffId,
        staffId,
        note: String(duty.note ?? "").trim(),
        overrideNote: override ? String(override.note ?? "").trim() : "",
        cancelled: Boolean(override) && !staffId,
        substituted: Boolean(override) && Boolean(staffId) && staffId !== baseStaffId,
      };
    })
    .sort(byDuty);
  const extras = dailyAssignments
    .map((item) => ({
      key: `daily-${item.id}`,
      source: "daily",
      weeklyDutyId: "",
      assignmentId: item.id,
      overrideId: "",
      dutyTypeId: item.dutyTypeId,
      dutyName: dutyName(dutyById, item.dutyTypeId),
      dutySortOrder: dutyOrder(dutyById, item.dutyTypeId),
      weekday,
      baseStaffId: "",
      staffId: String(item.staffId ?? ""),
      note: String(item.note ?? "").trim(),
      overrideNote: "",
      cancelled: false,
      substituted: false,
      updatedAt: item.updatedAt,
      updatedBy: item.updatedBy,
    }))
    .sort(byDuty);
  return [...scheduled, ...extras];
}

/* A duty on the board is worthless if the person behind it is not actually in the room today.
   These flags are what turn the roster from a list into something a leader can act on. */
export const DUTY_ISSUES = {
  staffMissing: "staff-missing",
  staffInactive: "staff-inactive",
  staffAbsent: "staff-absent",
  dutyInactive: "duty-inactive",
};

export function annotateDayDuties(
  entries,
  { staffById = new Map(), statuses = new Map(), dutyById = new Map() } = {}
) {
  return entries.map((entry) => {
    const issues = [];
    let statusCode = "";
    if (dutyById.get(entry.dutyTypeId)?.active === false)
      issues.push(DUTY_ISSUES.dutyInactive);
    if (!entry.cancelled) {
      const person = entry.staffId ? staffById.get(entry.staffId) : null;
      if (!person) issues.push(DUTY_ISSUES.staffMissing);
      else {
        if (person.active === false) issues.push(DUTY_ISSUES.staffInactive);
        const status = statuses.get(entry.staffId);
        if (status && status !== "working") {
          statusCode = status;
          issues.push(DUTY_ISSUES.staffAbsent);
        }
      }
    }
    // งดเวรที่ตั้งใจงด ไม่นับว่าไม่มีคนทำ ส่วนงานที่ปิดใช้ยังมีคนทำอยู่จริง จึงไม่นับเช่นกัน
    return {
      ...entry,
      issues,
      statusCode,
      uncovered: issues.some((issue) => issue !== DUTY_ISSUES.dutyInactive),
    };
  });
}

export function countUncoveredDuties(entries) {
  return entries.filter((entry) => entry.uncovered).length;
}

export function dutyIssueLabel(issue, { statusLabel = "ไม่อยู่ปฏิบัติงาน" } = {}) {
  if (issue === DUTY_ISSUES.staffMissing) return "ยังไม่มีคนรับผิดชอบ";
  if (issue === DUTY_ISSUES.staffInactive) return "พนักงานถูกปิดใช้งานแล้ว";
  if (issue === DUTY_ISSUES.staffAbsent) return `ผู้รับผิดชอบ${statusLabel}วันนี้`;
  if (issue === DUTY_ISSUES.dutyInactive) return "ประเภทงานถูกปิดใช้";
  return "";
}

export function buildCoverageRows(entries, staffById = new Map(), statusLabels = {}) {
  return entries
    .filter((entry) => entry.uncovered)
    .map((entry) => {
      const person = entry.staffId ? staffById.get(entry.staffId) : null;
      const status = entry.issues.includes(DUTY_ISSUES.staffAbsent)
        ? statusLabels[entry.statusCode] ?? "ไม่อยู่ปฏิบัติงาน"
        : "";
      return {
        key: entry.key,
        dutyName: entry.dutyName,
        detail: entry.issues
          .filter((issue) => issue !== DUTY_ISSUES.dutyInactive)
          .map((issue) => dutyIssueLabel(issue, { statusLabel: status }))
          .join(" · "),
        person: person?.nickname ?? "",
      };
    });
}

export function buildDutyLabelsFromEntries(entries, staffNameById = new Map()) {
  const labels = new Map();
  for (const entry of entries) {
    if (!entry.staffId) continue;
    const note = entry.overrideNote || entry.note;
    let label = note ? `${entry.dutyName} — ${note}` : entry.dutyName;
    if (entry.substituted) {
      const baseName = staffNameById.get(entry.baseStaffId);
      label += baseName ? ` (ทำแทน ${baseName})` : " (ทำแทน)";
    }
    const list = labels.get(entry.staffId) ?? [];
    list.push(label);
    labels.set(entry.staffId, list);
  }
  return labels;
}

export function countStaleWeeklyDuties(weeklyDuties = [], staffById = new Map()) {
  return weeklyDuties.filter((item) => {
    const person = staffById.get(item.staffId);
    return !person || person.active === false;
  }).length;
}

export function buildWeeklyGrid({
  weeklyDuties = [],
  dutyTypes = [],
  staffById = new Map(),
}) {
  const usedDutyIds = new Set(weeklyDuties.map((item) => item.dutyTypeId));
  const rows = dutyTypes
    .filter((duty) => duty.active !== false || usedDutyIds.has(duty.id))
    .slice()
    .sort(
      (a, b) =>
        Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) ||
        String(a.name ?? "").localeCompare(String(b.name ?? ""), "th")
    )
    .map((duty) => ({
      dutyTypeId: duty.id,
      dutyName: duty.name,
      inactive: duty.active === false,
      cells: WEEKDAYS.map((weekday) => ({
        weekday: weekday.value,
        items: weeklyDuties
          .filter(
            (item) =>
              item.dutyTypeId === duty.id && Number(item.weekday) === weekday.value
          )
          .map((item) => {
            const person = staffById.get(item.staffId);
            return {
              id: item.id,
              staffId: item.staffId,
              name: person?.nickname || "ไม่พบพนักงาน",
              note: String(item.note ?? "").trim(),
              missing: !person,
              inactive: person?.active === false,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name, "th")),
      })),
    }));
  return { weekdays: WEEKDAYS, rows };
}

export function buildDayChangeRows(entries, staffById = new Map()) {
  const nameOf = (staffId) => staffById.get(staffId)?.nickname || "ไม่พบพนักงาน";
  return entries
    .filter((entry) => entry.cancelled || entry.substituted || entry.source === "daily")
    .map((entry) => {
      if (entry.source === "daily")
        return {
          key: entry.key,
          dutyName: entry.dutyName,
          kind: "เพิ่มเฉพาะวัน",
          detail: `${nameOf(entry.staffId)}${entry.note ? ` — ${entry.note}` : ""}`,
        };
      if (entry.cancelled)
        return {
          key: entry.key,
          dutyName: entry.dutyName,
          kind: "งดเวรวันนี้",
          detail: `ตามตาราง ${nameOf(entry.baseStaffId)}${
            entry.overrideNote ? ` — ${entry.overrideNote}` : ""
          }`,
        };
      return {
        key: entry.key,
        dutyName: entry.dutyName,
        kind: "เปลี่ยนคนทำแทน",
        detail: `${nameOf(entry.staffId)} ทำแทน ${nameOf(entry.baseStaffId)}${
          entry.overrideNote ? ` — ${entry.overrideNote}` : ""
        }`,
      };
    });
}

export function validateWeeklyDuty(item, existing = []) {
  const errors = [];
  if (!isWeekdayValue(Number(item.weekday))) errors.push("weekday");
  if (!String(item.staffId ?? "").trim()) errors.push("staffId");
  if (!String(item.dutyTypeId ?? "").trim()) errors.push("dutyTypeId");
  const duplicate = existing.some(
    (other) =>
      other.id !== item.id &&
      Number(other.weekday) === Number(item.weekday) &&
      other.staffId === item.staffId &&
      other.dutyTypeId === item.dutyTypeId
  );
  if (duplicate) errors.push("duplicate");
  return errors;
}

export function weeklyDutyErrorMessage(errors) {
  if (errors.includes("duplicate"))
    return "มีเวรประจำของพนักงานคนนี้ในงานและวันเดียวกันอยู่แล้ว";
  return "กรุณาเลือกวัน ประเภทงาน และพนักงานให้ครบ";
}
