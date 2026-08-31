import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PACKING_NOTICE,
  buildPackingRoomTeam,
  buildDailyReportText,
  buildWorkforceSummary,
  filterDirectoryStaff,
  buildPackerOptions,
  copyAssignments,
  groupActiveStaff,
  mergeAssignments,
  maskStaffContact,
  reorderStaffWithinPosition,
  resolveDailyStatus,
  staffMissingFields,
  resolvePackingNotice,
  staffSaveErrorMessage,
  telHref,
  validateStaffInput,
} from "./staffDirectory.js";

test("builds a shareable daily report without private contact details", () => {
  const report = buildDailyReportText({
    dateLabel: "14 สิงหาคม 2569",
    summary: { total: 2, working: 1, leave: 1, off: 0, outside: 0, unassigned: 1 },
    leaderName: "หัวหน้า ก",
    assistantName: "ผู้ช่วย ข",
    staff: [
      { id: "1", fullName: "พนักงาน หนึ่ง", nickname: "หนึ่ง", position: "leader", phone: "0812345678" },
      { id: "2", fullName: "พนักงาน สอง", nickname: "สอง", position: "packer", email: "two@example.com" },
    ],
    statuses: new Map([["2", "leave"]]),
    dutyLabelsByStaff: new Map([["1", ["ตรวจพื้นที่"]]]),
    positionLabels: { leader: "หัวหน้า", packer: "Packer" },
    statusLabels: { working: "ปฏิบัติงาน", leave: "ลา" },
    notice: "รักษาความสะอาด",
  });

  assert.match(report, /รายงานสรุปการทำงานประจำวัน/);
  assert.match(report, /14 สิงหาคม 2569/);
  assert.match(report, /หัวหน้า: หัวหน้า ก/);
  assert.match(report, /พนักงาน หนึ่ง \(หนึ่ง\) — หัวหน้า — ปฏิบัติงาน — ตรวจพื้นที่/);
  assert.match(report, /พนักงาน สอง \(สอง\) — Packer — ลา — ยังไม่ได้กำหนดหน้าที่/);
  assert.match(report, /รักษาความสะอาด/);
  assert.doesNotMatch(report, /0812345678|two@example\.com/);
});

test("uses the default packing notice until an admin saves custom text", () => {
  assert.equal(resolvePackingNotice("  "), DEFAULT_PACKING_NOTICE);
  assert.equal(
    resolvePackingNotice("  ตรวจพื้นที่ก่อนส่งมอบงาน  "),
    "ตรวจพื้นที่ก่อนส่งมอบงาน"
  );
});

test("places checkers before packers in one packing-room team", () => {
  const groups = {
    checker: [{ id: "checker-1" }],
    packer: [{ id: "packer-1" }, { id: "packer-2" }],
  };

  assert.deepEqual(
    buildPackingRoomTeam(groups).map((person) => person.id),
    ["checker-1", "packer-1", "packer-2"]
  );
});

test("defaults active staff to working and summarizes daily exceptions", () => {
  const staff = [
    { id: "1", active: true },
    { id: "2", active: true },
    { id: "3", active: false },
  ];
  const statuses = new Map([["2", "leave"]]);
  assert.equal(resolveDailyStatus("1", statuses), "working");
  // คนที่ลาไม่ถูกนับว่า "ยังไม่มีหน้าที่" เพราะวันนั้นเขาไม่ต้องมีหน้าที่อยู่แล้ว
  // (เทสต์เดิมล็อกไว้ที่ 2 ซึ่งทำให้ตัวเลขค้างเตือนตลอดในข้อมูลจริง)
  assert.deepEqual(buildWorkforceSummary(staff, statuses, new Map()), {
    total: 2,
    working: 1,
    leave: 1,
    off: 0,
    outside: 0,
    unassigned: 1,
  });
});

test("strips spacing out of the dial link but keeps a leading plus", () => {
  assert.equal(telHref("061 474 9196"), "tel:0614749196");
  assert.equal(telHref("+66 61-474-9196"), "tel:+66614749196");
  assert.equal(telHref("  "), "");
});

test("masks public contact details without hiding them from admins", () => {
  assert.equal(maskStaffContact("0614749196", "phone"), "061-xxx-9196");
  assert.equal(maskStaffContact("krittidet1989", "line"), "kr***89");
  assert.equal(maskStaffContact("name@example.com", "email"), "na***@example.com");
});

test("filters staff by position, status, assignment and duty text", () => {
  const staff = [
    { id: "1", position: "checker", nickname: "มาย", active: true },
    { id: "2", position: "packer", nickname: "มุก", active: true },
  ];
  const statuses = new Map([["2", "leave"]]);
  const duties = new Map([["1", ["เช็คสินค้าโซน A"]]]);
  assert.deepEqual(
    filterDirectoryStaff(staff, {
      query: "โซน a",
      position: "checker",
      status: "working",
      duty: "assigned",
      statuses,
      duties,
    }).map((item) => item.id),
    ["1"]
  );
});

test("reports missing profile fields and reorders only within one position", () => {
  assert.deepEqual(
    staffMissingFields(
      { fullName: "ก", employeeId: "1", photoUrl: "", phone: "" },
      []
    ),
    ["รูป", "ข้อมูลติดต่อ", "หน้าที่วันนี้"]
  );
  const reordered = reorderStaffWithinPosition(
    [
      { id: "c1", position: "checker" },
      { id: "c2", position: "checker" },
      { id: "p1", position: "packer" },
    ],
    "c2",
    "c1"
  );
  assert.deepEqual(reordered.map((item) => item.id), ["c2", "c1", "p1"]);
  assert.deepEqual(reordered.map((item) => item.sortOrder), [0, 1, undefined]);
});

test("groups active staff by position and preserves configured order", () => {
  const groups = groupActiveStaff([
    { id: "3", position: "packer", sortOrder: 2, active: true },
    { id: "1", position: "leader", sortOrder: 1, active: true },
    { id: "2", position: "packer", sortOrder: 1, active: true },
    { id: "4", position: "checker", sortOrder: 1, active: false },
  ]);

  assert.deepEqual(
    groups.leader.map((item) => item.id),
    ["1"]
  );
  assert.deepEqual(groups.checker, []);
  assert.deepEqual(
    groups.packer.map((item) => item.id),
    ["2", "3"]
  );
});

test("builds scan options from every active staff position in hierarchy order", () => {
  assert.deepEqual(
    buildPackerOptions([
      { nickname: "มาย", position: "packer", active: true, sortOrder: 2 },
      { nickname: "กิต", position: "packer", active: true, sortOrder: 1 },
      { nickname: "หัวหน้า", position: "leader", active: true, sortOrder: 1 },
      { nickname: "เช็ค", position: "checker", active: true, sortOrder: 1 },
      { nickname: "เก่า", position: "packer", active: false, sortOrder: 0 },
    ]),
    ["หัวหน้า", "เช็ค", "กิต", "มาย"]
  );
});

test("rejects duplicate scan nicknames across staff positions", () => {
  assert.throws(
    () =>
      buildPackerOptions([
        { nickname: "กิต", position: "leader", active: true },
        { nickname: " กิต ", position: "packer", active: true },
      ]),
    (error) => error.code === "STAFF_DUPLICATE_PACKER_NICKNAME"
  );
});

test("validates required staff fields independently from optional contacts", () => {
  assert.deepEqual(
    validateStaffInput({
      fullName: "สมชาย ใจดี",
      nickname: "ชาย",
      position: "checker",
    }),
    []
  );
  assert.deepEqual(
    validateStaffInput({ fullName: "", nickname: "", position: "unknown" }),
    ["fullName", "nickname", "position"]
  );
});

test("allows a blank employee id but rejects a duplicate entered id", () => {
  const existing = [{ id: "staff-1", employeeId: "HK-001" }];
  assert.deepEqual(
    validateStaffInput(
      {
        id: "staff-2",
        fullName: "สมหญิง ใจดี",
        nickname: "หญิง",
        position: "packer",
        employeeId: "",
      },
      existing
    ),
    []
  );
  assert.deepEqual(
    validateStaffInput(
      {
        id: "staff-2",
        fullName: "สมหญิง ใจดี",
        nickname: "หญิง",
        position: "packer",
        employeeId: " hk-001 ",
      },
      existing
    ),
    ["employeeId"]
  );
});

test("copies assignments to a new date without mutating the source", () => {
  const source = [
    { staffId: "u1", dutyTypeId: "packing", note: "โซน A", date: "2026-08-13" },
  ];
  assert.deepEqual(copyAssignments(source, "2026-08-14"), [
    {
      staffId: "u1",
      dutyTypeId: "packing",
      note: "โซน A",
      date: "2026-08-14",
    },
  ]);
  assert.equal(source[0].date, "2026-08-13");
});

test("merges copied assignments without duplicating the same person and duty", () => {
  const existing = [{ staffId: "u1", dutyTypeId: "packing" }];
  const copied = [
    { staffId: "u1", dutyTypeId: "packing" },
    { staffId: "u1", dutyTypeId: "checking" },
    { staffId: "u1", dutyTypeId: "checking" },
  ];
  assert.deepEqual(mergeAssignments(existing, copied), [
    { staffId: "u1", dutyTypeId: "checking" },
  ]);
});

test("maps staff save failures to actionable Thai messages without internal details", () => {
  assert.equal(
    staffSaveErrorMessage({ code: "permission-denied" }),
    "ไม่มีสิทธิ์บันทึกข้อมูลพนักงาน กรุณาเข้าสู่ระบบใหม่"
  );
  assert.equal(
    staffSaveErrorMessage({ code: "storage/unauthorized" }),
    "ไม่มีสิทธิ์อัปโหลดรูปพนักงาน กรุณาเข้าสู่ระบบใหม่"
  );
  assert.equal(
    staffSaveErrorMessage({
      code: "STAFF_DUPLICATE_EMPLOYEE_ID",
      message: "internal",
    }),
    "รหัสพนักงานนี้ถูกใช้งานแล้ว"
  );
  assert.equal(
    staffSaveErrorMessage({ code: "STAFF_DUTY_DELETE_LIMIT" }),
    "เวรนี้มีรายการเปลี่ยนแปลงรายวันมากเกินกว่าจะลบอัตโนมัติ กรุณาลบรายการรายวันเก่าก่อน"
  );
});
