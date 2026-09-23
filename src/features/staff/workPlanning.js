export const WORK_PLAN_TASK_LIMIT = 200;
export const STAFF_SOP_LIMIT = 100;
export const SOP_STEP_LIMIT = 30;

export function isValidDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const WORK_PLAN_STATUSES = {
  planned: "วางแผน",
  in_progress: "กำลังทำ",
  blocked: "ติดปัญหา",
  completed: "เสร็จแล้ว",
};

export function cleanSopSteps(steps = []) {
  return steps.slice(0, SOP_STEP_LIMIT).map((step, index) => ({
    id: String(step.id || `step-${index + 1}`),
    title: String(step.title ?? "").trim().slice(0, 120),
    instruction: String(step.instruction ?? "").trim().slice(0, 1000),
    verification: String(step.verification ?? "").trim().slice(0, 500),
    required: step.required !== false,
  }));
}

export function validateSopDraft(sop) {
  const errors = [];
  if (!String(sop.title ?? "").trim()) errors.push("title");
  if (String(sop.title ?? "").trim().length > 120) errors.push("title-length");
  if (String(sop.description ?? "").trim().length > 1000) errors.push("description-length");
  if (!String(sop.ownerStaffId ?? "").trim()) errors.push("owner");
  if (!isValidDateKey(sop.effectiveDate)) errors.push("effective-date");
  if (!isValidDateKey(sop.reviewDueDate) || sop.reviewDueDate < sop.effectiveDate) errors.push("review-date");
  if (!Array.isArray(sop.steps) || !sop.steps.length) errors.push("steps");
  if (Array.isArray(sop.steps) && sop.steps.length > SOP_STEP_LIMIT) errors.push("step-limit");
  if (Array.isArray(sop.steps)) {
    const ids = new Set();
    sop.steps.forEach((step) => {
      if (!String(step.title ?? "").trim()) errors.push("step-title");
      if (step.id && ids.has(String(step.id))) errors.push("duplicate-step-id");
      if (step.id) ids.add(String(step.id));
    });
  }
  return [...new Set(errors)];
}

export function validateWorkPlanTask(task, sops = []) {
  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(task.date ?? ""))) errors.push("date");
  if (!String(task.sopId ?? "").trim()) errors.push("sopId");
  if (!Number.isInteger(Number(task.sopVersion)) || Number(task.sopVersion) < 1) errors.push("sopVersion");
  if (!Array.isArray(task.assignedStaffIds) || !task.assignedStaffIds.length) errors.push("assignees");
  if (!Array.isArray(task.dependsOnTaskIds) || task.dependsOnTaskIds.length > 20) errors.push("dependencies");
  if (Array.isArray(task.dependsOnTaskIds) && new Set(task.dependsOnTaskIds).size !== task.dependsOnTaskIds.length) errors.push("duplicate-dependency");
  if (Array.isArray(task.dependsOnTaskIds) && task.dependsOnTaskIds.includes(task.id)) errors.push("self-dependency");
  if (!Number.isInteger(Number(task.sequence)) || Number(task.sequence) < 1) errors.push("sequence");
  if (task.targetTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(task.targetTime)) errors.push("targetTime");
  if (sops.length && !sops.some((sop) => sop.id === task.sopId && sop.active !== false)) errors.push("inactiveSop");
  if (!task.sopSnapshot || !Array.isArray(task.sopSnapshot.steps) || !task.sopSnapshot.steps.length) errors.push("sopSnapshot");
  return errors;
}

export function createSopSnapshot(sop, version) {
  return {
    sopId: String(sop.id),
    version: Number(version),
    title: String(sop.title ?? "").trim(),
    description: String(sop.description ?? "").trim(),
    ownerStaffId: String(sop.ownerStaffId ?? ""),
    effectiveDate: String(sop.effectiveDate ?? ""),
    reviewDueDate: String(sop.reviewDueDate ?? ""),
    steps: cleanSopSteps(sop.steps),
  };
}

export function sortWorkPlanTasks(tasks = []) {
  return tasks.slice().sort(
    (a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0)
      || String(a.id).localeCompare(String(b.id))
  );
}

export function canCompleteSopStep(snapshot, stepProgress = {}, stepIndex) {
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= (snapshot?.steps?.length ?? 0)) return false;
  return snapshot.steps.slice(0, stepIndex).every((step) => (
    step.required === false || stepProgress[step.id] === true
  ));
}

export function canCompleteWorkPlanTask(task) {
  const required = task?.sopSnapshot?.steps?.filter((step) => step.required !== false) ?? [];
  return required.every((step) => task?.stepProgress?.[step.id] === true);
}

export function canStartWorkPlanTask(task, tasks = []) {
  const byId = new Map(tasks.map((item) => [item.id, item]));
  return (task?.dependsOnTaskIds ?? []).every((id) => byId.get(id)?.status === "completed");
}

export function summarizeWorkPlan(tasks = []) {
  const summary = { total: tasks.length, planned: 0, in_progress: 0, blocked: 0, completed: 0 };
  for (const task of tasks) {
    if (Object.hasOwn(summary, task.status)) summary[task.status] += 1;
    else summary.planned += 1;
  }
  return summary;
}

export function nextTaskSequence(tasks = []) {
  return tasks.reduce((max, task) => Math.max(max, Number(task.sequence) || 0), 0) + 1;
}
