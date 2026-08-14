import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PACKING_NOTICE,
  buildDutyLabelsByStaff,
  buildPackerOptions,
  copyAssignments,
  groupActiveStaff,
  mergeAssignments,
  resolvePackingNotice,
  staffSaveErrorMessage,
  validateStaffInput,
} from "./staffDirectory.js";

test("uses the default packing notice until an admin saves custom text", () => {
  assert.equal(resolvePackingNotice("  "), DEFAULT_PACKING_NOTICE);
  assert.equal(
    resolvePackingNotice("  ตรวจพื้นที่ก่อนส่งมอบงาน  "),
    "ตรวจพื้นที่ก่อนส่งมอบงาน"
  );
});

test("groups today's duty labels by staff for directory cards", () => {
  const dutyById = new Map([
    ["packing", { name: "แพ็คสินค้าโซน A" }],
    ["checking", { name: "ตรวจสอบสินค้า" }],
  ]);

  assert.deepEqual(
    [...buildDutyLabelsByStaff(
      [
        { staffId: "u1", dutyTypeId: "packing", note: "โต๊ะ 1" },
        { staffId: "u1", dutyTypeId: "checking", note: "" },
        { staffId: "u2", dutyTypeId: "legacy", note: "ช่วยโหลดของ" },
      ],
      dutyById
    )],
    [
      ["u1", ["แพ็คสินค้าโซน A — โต๊ะ 1", "ตรวจสอบสินค้า"]],
      ["u2", ["ประเภทงานเดิม — ช่วยโหลดของ"]],
    ]
  );
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
});
