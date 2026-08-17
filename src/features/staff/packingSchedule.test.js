import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDayChangeRows,
  buildDutyLabelsFromEntries,
  buildWeeklyGrid,
  overrideDocId,
  resolveDayDuties,
  validateWeeklyDuty,
  weekdayFromDateKey,
  weekdayLabel,
} from "./packingSchedule.js";

const dutyById = new Map([
  ["duty-pack", { id: "duty-pack", name: "แพ็คโซน A", sortOrder: 0 }],
  ["duty-check", { id: "duty-check", name: "ตรวจสินค้า", sortOrder: 1 }],
]);
const staffById = new Map([
  ["staff-a", { id: "staff-a", nickname: "เอ", fullName: "พนักงาน เอ" }],
  ["staff-b", { id: "staff-b", nickname: "บี", fullName: "พนักงาน บี" }],
]);
const weeklyDuties = [
  {
    id: "w-1",
    weekday: 1,
    staffId: "staff-a",
    dutyTypeId: "duty-pack",
    note: "โซนหน้า",
  },
  { id: "w-2", weekday: 1, staffId: "staff-b", dutyTypeId: "duty-check", note: "" },
  { id: "w-3", weekday: 2, staffId: "staff-a", dutyTypeId: "duty-check", note: "" },
];

test("reads the weekday straight off the Bangkok date key", () => {
  // 17 สิงหาคม 2026 คือวันจันทร์ — ห้ามแปลงเป็น instant ก่อน ไม่งั้นคลาด 7 ชั่วโมง
  assert.equal(weekdayFromDateKey("2026-08-17"), 1);
  assert.equal(weekdayFromDateKey("2026-08-16"), 0);
  assert.equal(weekdayLabel(weekdayFromDateKey("2026-08-17")), "จันทร์");
  assert.equal(weekdayFromDateKey("2026-02-30"), null);
  assert.equal(weekdayFromDateKey(""), null);
});

test("a day follows the fixed weekly table when nothing is overridden", () => {
  const entries = resolveDayDuties({
    dateKey: "2026-08-17",
    weeklyDuties,
    dutyById,
  });

  assert.deepEqual(
    entries.map((entry) => [entry.dutyName, entry.staffId, entry.source]),
    [
      ["แพ็คโซน A", "staff-a", "weekly"],
      ["ตรวจสินค้า", "staff-b", "weekly"],
    ]
  );
  assert.ok(entries.every((entry) => !entry.substituted && !entry.cancelled));
});

test("an override swaps the person for that date only, leaving the table alone", () => {
  const overrides = [
    {
      id: overrideDocId("2026-08-17", "w-1"),
      date: "2026-08-17",
      weeklyDutyId: "w-1",
      staffId: "staff-b",
      note: "เอลาป่วย",
    },
  ];
  const monday = resolveDayDuties({
    dateKey: "2026-08-17",
    weeklyDuties,
    overrides,
    dutyById,
  });
  const nextMonday = resolveDayDuties({
    dateKey: "2026-08-24",
    weeklyDuties,
    overrides,
    dutyById,
  });

  const swapped = monday.find((entry) => entry.weeklyDutyId === "w-1");
  assert.equal(swapped.staffId, "staff-b");
  assert.equal(swapped.baseStaffId, "staff-a");
  assert.equal(swapped.substituted, true);
  // สัปดาห์ถัดไปยังยึดตามตารางเดิม เพราะ override ผูกกับวันที่ ไม่ใช่กับเวร
  assert.equal(
    nextMonday.find((entry) => entry.weeklyDutyId === "w-1").staffId,
    "staff-a"
  );
});

test("an override with no substitute cancels the duty for that day", () => {
  const [entry] = resolveDayDuties({
    dateKey: "2026-08-18",
    weeklyDuties,
    overrides: [{ id: "x", weeklyDutyId: "w-3", staffId: "", note: "งดงาน" }],
    dutyById,
  });

  assert.equal(entry.cancelled, true);
  assert.equal(entry.staffId, "");
  assert.equal(entry.substituted, false);
});

test("ad-hoc daily assignments sit after the scheduled duties", () => {
  const entries = resolveDayDuties({
    dateKey: "2026-08-17",
    weeklyDuties,
    dailyAssignments: [
      { id: "d-1", staffId: "staff-a", dutyTypeId: "duty-check", note: "งานด่วน" },
    ],
    dutyById,
  });

  assert.equal(entries.length, 3);
  assert.equal(entries.at(-1).source, "daily");
  assert.equal(entries.at(-1).assignmentId, "d-1");
});

test("duty labels credit the substitute and name who was replaced", () => {
  const entries = resolveDayDuties({
    dateKey: "2026-08-17",
    weeklyDuties,
    overrides: [{ id: "x", weeklyDutyId: "w-1", staffId: "staff-b", note: "" }],
    dutyById,
  });
  const labels = buildDutyLabelsFromEntries(
    entries,
    new Map([...staffById].map(([id, person]) => [id, person.nickname]))
  );

  assert.deepEqual(labels.get("staff-b"), [
    "แพ็คโซน A — โซนหน้า (ทำแทน เอ)",
    "ตรวจสินค้า",
  ]);
  assert.equal(labels.has("staff-a"), false);
});

test("the weekly grid keeps one row per duty and one cell per weekday", () => {
  const grid = buildWeeklyGrid({
    weeklyDuties,
    dutyTypes: [...dutyById.values()],
    staffById,
  });

  assert.deepEqual(
    grid.rows.map((row) => row.dutyName),
    ["แพ็คโซน A", "ตรวจสินค้า"]
  );
  assert.equal(grid.rows[0].cells.length, 7);
  assert.deepEqual(
    grid.rows[0].cells.map((cell) => cell.items.map((item) => item.name)),
    [["เอ"], [], [], [], [], [], []]
  );
});

test("the printed change list explains every deviation from the table", () => {
  const entries = resolveDayDuties({
    dateKey: "2026-08-17",
    weeklyDuties,
    overrides: [
      { id: "x", weeklyDutyId: "w-1", staffId: "staff-b", note: "เอลา" },
      { id: "y", weeklyDutyId: "w-2", staffId: "", note: "" },
    ],
    dailyAssignments: [{ id: "d-1", staffId: "staff-a", dutyTypeId: "duty-check", note: "" }],
    dutyById,
  });

  assert.deepEqual(
    buildDayChangeRows(entries, staffById).map((row) => [row.kind, row.detail]),
    [
      ["เปลี่ยนคนทำแทน", "บี ทำแทน เอ — เอลา"],
      ["งดเวรวันนี้", "ตามตาราง บี"],
      ["เพิ่มเฉพาะวัน", "เอ"],
    ]
  );
});

test("rejects an incomplete or duplicated weekly duty", () => {
  assert.deepEqual(validateWeeklyDuty({ weekday: 9, staffId: "", dutyTypeId: "" }), [
    "weekday",
    "staffId",
    "dutyTypeId",
  ]);
  assert.deepEqual(
    validateWeeklyDuty(
      { weekday: 1, staffId: "staff-a", dutyTypeId: "duty-pack" },
      weeklyDuties
    ),
    ["duplicate"]
  );
  assert.deepEqual(
    validateWeeklyDuty(
      { id: "w-1", weekday: 1, staffId: "staff-a", dutyTypeId: "duty-pack" },
      weeklyDuties
    ),
    []
  );
});
