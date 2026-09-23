import test from "node:test";
import assert from "node:assert/strict";

import {
  canCompleteSopStep,
  canCompleteWorkPlanTask,
  canStartWorkPlanTask,
  cleanSopSteps,
  createSopSnapshot,
  nextTaskSequence,
  sortWorkPlanTasks,
  summarizeWorkPlan,
  validateSopDraft,
  validateWorkPlanTask,
} from "./workPlanning.js";
import { findStaffModule, STAFF_WORKSPACE_MODULE } from "./staffModules.js";

const sop = {
  id: "sop-check",
  title: "ตรวจสินค้า",
  description: "ตรวจสอบก่อนแพ็ค",
  ownerStaffId: "staff-a",
  effectiveDate: "2026-09-23",
  reviewDueDate: "2027-09-23",
  steps: [
    { id: "one", title: "ตรวจรุ่น", instruction: "เทียบกับใบสั่ง", verification: "รุ่นตรง", required: true },
    { id: "two", title: "ตรวจสภาพ", instruction: "ตรวจรอบกล่อง", verification: "ไม่มีรอยเสียหาย", required: true },
  ],
};

test("SOP drafts require ownership, valid control dates and at least one named step", () => {
  assert.deepEqual(validateSopDraft({ title: "", steps: [] }), ["title", "owner", "effective-date", "review-date", "steps"]);
  assert.deepEqual(validateSopDraft({ ...sop, steps: [{ id: "x", title: " " }] }), ["step-title"]);
  assert.deepEqual(validateSopDraft(sop), []);
  assert.deepEqual(validateSopDraft({ ...sop, effectiveDate: "2026-02-30", reviewDueDate: "2026-01-01" }), ["effective-date", "review-date"]);
});

test("SOP draft steps are normalized and capped before storage", () => {
  const steps = cleanSopSteps([
    { id: "same", title: ` ${"ก".repeat(140)} `, instruction: " ทำ " },
    { id: "same", title: "ขั้นสอง" },
    ...Array.from({ length: 40 }, (_, index) => ({ id: `x-${index}`, title: "งาน" })),
  ]);
  assert.equal(steps.length, 30);
  assert.equal(steps[0].title.length, 120);
  assert.equal(steps[0].instruction, "ทำ");
  assert.deepEqual(validateSopDraft({ ...sop, steps }), ["duplicate-step-id"]);
});

test("published SOP snapshots preserve the exact version and ordered steps", () => {
  const snapshot = createSopSnapshot(sop, 3);
  assert.deepEqual(
    [snapshot.sopId, snapshot.version, snapshot.title, snapshot.steps.map((step) => step.id)],
    ["sop-check", 3, "ตรวจสินค้า", ["one", "two"]],
  );
  const editedDraft = { ...sop, title: "ชื่อใหม่" };
  assert.equal(createSopSnapshot(editedDraft, 4).title, "ชื่อใหม่");
  assert.deepEqual(
    [snapshot.ownerStaffId, snapshot.effectiveDate, snapshot.reviewDueDate],
    ["staff-a", "2026-09-23", "2027-09-23"],
  );
  assert.equal(snapshot.title, "ตรวจสินค้า");
});

test("ordered SOP steps cannot be completed before required prior steps", () => {
  const snapshot = createSopSnapshot(sop, 1);
  assert.equal(canCompleteSopStep(snapshot, {}, 0), true);
  assert.equal(canCompleteSopStep(snapshot, {}, 1), false);
  assert.equal(canCompleteSopStep(snapshot, { one: true }, 1), true);
  assert.equal(canCompleteSopStep(snapshot, {}, -1), false);
});

test("a work plan cannot be closed before required SOP checks are complete", () => {
  const snapshot = createSopSnapshot(sop, 1);
  assert.equal(canCompleteWorkPlanTask({ sopSnapshot: snapshot, stepProgress: {} }), false);
  assert.equal(canCompleteWorkPlanTask({ sopSnapshot: snapshot, stepProgress: { one: true, two: true } }), true);
  const optionalOnly = { sopSnapshot: { steps: [{ id: "optional", required: false }] }, stepProgress: {} };
  assert.equal(canCompleteWorkPlanTask(optionalOnly), true);
});

test("a sequenced task starts only after its selected prerequisites are complete", () => {
  const first = { id: "first", status: "in_progress" };
  const next = { id: "next", dependsOnTaskIds: ["first"] };
  assert.equal(canStartWorkPlanTask(next, [first, next]), false);
  assert.equal(canStartWorkPlanTask(next, [{ ...first, status: "completed" }, next]), true);
  assert.equal(canStartWorkPlanTask({ id: "parallel", dependsOnTaskIds: [] }, [first]), true);
  assert.equal(canStartWorkPlanTask(next, [next]), false);
});

test("work plan validation checks date, published SOP, assignment and snapshot", () => {
  const task = {
    date: "2026-09-23",
    sopId: "sop-check",
    sopVersion: 1,
    assignedStaffIds: ["staff-a"],
    dependsOnTaskIds: [],
    sequence: 1,
    targetTime: "09:30",
    sopSnapshot: createSopSnapshot(sop, 1),
  };
  assert.deepEqual(validateWorkPlanTask(task, [{ id: "sop-check", active: true }]), []);
  assert.deepEqual(
    validateWorkPlanTask({ ...task, date: "bad", targetTime: "25:00", assignedStaffIds: [], sequence: 0 }, []),
    ["date", "assignees", "sequence", "targetTime"],
  );
  assert.ok(validateWorkPlanTask({ ...task, sopId: "retired" }, [{ id: "retired", active: false }]).includes("inactiveSop"));
});

test("work plan rows sort by sequence and summary counts every state", () => {
  const tasks = sortWorkPlanTasks([
    { id: "b", sequence: 2, status: "blocked" },
    { id: "a", sequence: 1, status: "completed" },
    { id: "c", sequence: 3, status: "in_progress" },
  ]);
  assert.deepEqual(tasks.map((task) => task.id), ["a", "b", "c"]);
  assert.deepEqual(summarizeWorkPlan(tasks), {
    total: 3, planned: 0, in_progress: 1, blocked: 1, completed: 1,
  });
  assert.equal(nextTaskSequence(tasks), 4);
});

test("staff workspace keeps team, schedule, daily plan and SOP as sibling modules", () => {
  assert.equal(STAFF_WORKSPACE_MODULE.id, "staff-workspace");
  assert.deepEqual(STAFF_WORKSPACE_MODULE.modules.map((item) => item.id), ["directory", "schedule", "workplan", "sops"]);
  assert.equal(findStaffModule("schedule").id, "schedule");
  assert.equal(findStaffModule("sops").id, "sops");
  assert.equal(findStaffModule("unknown"), null);
});
