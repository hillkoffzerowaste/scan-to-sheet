import React, { useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import {
  createWorkPlanTask,
  deleteWorkPlanTask,
  getStaffSopVersion,
  saveWorkPlanOrder,
  updateWorkPlanTask,
} from "../workPlanningService.js";
import {
  canCompleteSopStep,
  canStartWorkPlanTask,
  nextTaskSequence,
  summarizeWorkPlan,
  WORK_PLAN_STATUSES,
  WORK_PLAN_TASK_LIMIT,
} from "../workPlanning.js";

export default function WorkPlanBoard({
  date, tasks, sops, staff, isAdmin, firebaseUser, onRefresh, onMessage, onError,
}) {
  const [taskEditor, setTaskEditor] = useState(null);
  const [saving, setSaving] = useState(false);
  const activeStaff = useMemo(() => staff.filter((person) => person.active !== false), [staff]);
  const activeSops = sops.filter((sop) => sop.active !== false && Number(sop.latestVersion) > 0);
  const summary = useMemo(() => summarizeWorkPlan(tasks), [tasks]);

  async function createTask(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const sop = activeSops.find((item) => item.id === taskEditor.sopId);
    const assignedStaffIds = form.getAll("assignedStaffIds").map(String);
    const dependsOnTaskIds = form.getAll("dependsOnTaskIds").map(String);
    if (!sop || !assignedStaffIds.length) {
      onError?.(!sop ? "เลือก SOP ที่เผยแพร่แล้วก่อนสร้างงาน" : "เลือกผู้รับผิดชอบอย่างน้อย 1 คน");
      return;
    }
    setSaving(true);
    try {
      const version = Number(sop.latestVersion);
      const published = await getStaffSopVersion(sop.id, version);
      if (!published) throw Object.assign(new Error(), { code: "STAFF_SOP_VERSION_MISSING" });
      await createWorkPlanTask({
        date,
        sequence: nextTaskSequence(tasks),
        targetTime: String(form.get("targetTime") ?? ""),
        assignedStaffIds,
        dependsOnTaskIds,
        sopId: sop.id,
        sopVersion: version,
        sopSnapshot: {
          sopId: sop.id,
          version,
          title: published.title,
          description: published.description,
          steps: published.steps,
        },
        note: form.get("note"),
      }, firebaseUser);
      setTaskEditor(null);
      onMessage?.("เพิ่มงานลงแผนวันนี้แล้ว");
      await onRefresh?.();
    } catch (error) {
      onError?.(error);
    } finally {
      setSaving(false);
    }
  }

  async function updateTask(task, changes) {
    try {
      await updateWorkPlanTask(task, changes, firebaseUser);
      await onRefresh?.();
    } catch (error) {
      onError?.(error);
    }
  }

  async function moveTask(task, direction) {
    const index = tasks.findIndex((item) => item.id === task.id);
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= tasks.length) return;
    const reordered = tasks.slice();
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    setSaving(true);
    try {
      await saveWorkPlanOrder(reordered, firebaseUser);
      await onRefresh?.();
    } catch (error) {
      onError?.(error);
    } finally {
      setSaving(false);
    }
  }

  async function removeTask(task) {
    if (!window.confirm(`ลบงานลำดับ ${task.sequence} “${task.sopSnapshot.title}” จากแผนวันนี้หรือไม่?`)) return;
    if (tasks.some((item) => item.dependsOnTaskIds?.includes(task.id))) {
      onError?.("มีงานอื่นรอขั้นตอนนี้อยู่ กรุณาปรับงานที่ตามหลังหรือยกเลิกการอ้างอิงก่อนลบ");
      return;
    }
    const remaining = tasks.filter((item) => item.id !== task.id);
    try {
      await deleteWorkPlanTask(task, remaining, firebaseUser);
      await onRefresh?.();
    } catch (error) {
      onError?.(error);
    }
  }

  async function toggleStep(task, step, checked) {
    const stepProgress = { ...(task.stepProgress ?? {}), [step.id]: checked };
    const requiredSteps = task.sopSnapshot.steps.filter((item) => item.required !== false);
    const complete = requiredSteps.every((item) => stepProgress[item.id] === true);
    const anyDone = Object.values(stepProgress).some(Boolean);
    await updateTask(task, {
      stepProgress,
      status: complete ? "completed" : anyDone ? "in_progress" : "planned",
    });
  }

  return (
    <div className="staff-plan-module">
      <div className="staff-module-header">
        <div><h4>แผนงานประจำวันที่ {date}</h4><p>ลำดับงานและขั้นตอนอ้างอิงตามเวอร์ชัน SOP ที่บันทึกไว้กับงาน</p></div>
        {isAdmin && <button className="primary-action" type="button" disabled={tasks.length >= WORK_PLAN_TASK_LIMIT} onClick={() => setTaskEditor({ sopId: "", dependsOnTaskIds: tasks.length ? [tasks[tasks.length - 1].id] : [] })}><Plus size={16} /> เพิ่มงานในแผน</button>}
      </div>
      <div className="work-plan-summary" aria-label="สรุปสถานะแผนงาน">
        {[["งานทั้งหมด", summary.total], ["วางแผน", summary.planned], ["กำลังทำ", summary.in_progress], ["ติดปัญหา", summary.blocked], ["เสร็จแล้ว", summary.completed]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      {tasks.length ? (
        <div className="work-plan-table-wrap">
          <table className="work-plan-table">
            <caption>งานเรียงตามลำดับปฏิบัติ · เลื่อนในตารางเพื่อดูคอลัมน์ทั้งหมด</caption>
            <thead><tr><th scope="col">ลำดับ</th><th scope="col">งาน / SOP</th><th scope="col">ผู้รับผิดชอบ</th><th scope="col">เวลาเป้าหมาย</th><th scope="col">สถานะ</th><th scope="col">ความคืบหน้า</th><th scope="col">จัดการ</th></tr></thead>
            <tbody>{tasks.map((task, index) => {
              const required = task.sopSnapshot.steps.filter((step) => step.required !== false);
              const completed = required.filter((step) => task.stepProgress?.[step.id] === true).length;
              const assigned = task.assignedStaffIds.map((id) => staff.find((person) => person.id === id)?.nickname ?? "ไม่พบพนักงาน");
              return (
                <tr key={task.id}>
                  <td><strong>{task.sequence}</strong></td>
                  <td className="work-plan-task-name"><strong>{task.sopSnapshot.title}</strong><span>{task.sopSnapshot.description || "ไม่มีรายละเอียดเพิ่มเติม"}</span>{task.dependsOnTaskIds?.length > 0 && <small>เริ่มหลังงาน {task.dependsOnTaskIds.map((id) => tasks.find((item) => item.id === id)?.sequence ?? "ที่ถูกลบ").join(", ")} เสร็จ</small>}<details><summary>ดูขั้นตอน SOP · v{task.sopVersion}</summary><ol>{task.sopSnapshot.steps.map((step, stepIndex) => {
                    const checked = task.stepProgress?.[step.id] === true;
                    const enabled = isAdmin && (checked || canCompleteSopStep(task.sopSnapshot, task.stepProgress, stepIndex));
                    return <li key={step.id}><label><input type="checkbox" checked={checked} disabled={!enabled || task.status === "blocked"} onChange={(event) => void toggleStep(task, step, event.target.checked)} /><span><strong>{step.title}</strong><small>{step.instruction}</small>{step.verification && <small>จุดตรวจ: {step.verification}</small>}</span></label></li>;
                  })}</ol></details>{task.note && <small>หมายเหตุ: {task.note}</small>}</td>
                  <td>{assigned.join("、")}</td><td>{task.targetTime || "—"}</td>
                  <td><select aria-label={`สถานะงาน ${task.sequence}`} value={task.status} disabled={!isAdmin} onChange={(event) => void updateTask(task, { status: event.target.value })}>{Object.entries(WORK_PLAN_STATUSES).map(([value, label]) => <option key={value} value={value} disabled={(value === "completed" && completed < required.length) || (value === "in_progress" && !canStartWorkPlanTask(task, tasks))}>{label}</option>)}</select></td>
                  <td>{completed}/{required.length} ขั้น</td>
                  <td><div className="work-plan-row-actions"><button type="button" aria-label={`เลื่อนงาน ${task.sequence} ขึ้น`} disabled={!isAdmin || saving || index === 0} onClick={() => void moveTask(task, -1)}><ArrowUp size={15} /></button><button type="button" aria-label={`เลื่อนงาน ${task.sequence} ลง`} disabled={!isAdmin || saving || index === tasks.length - 1} onClick={() => void moveTask(task, 1)}><ArrowDown size={15} /></button>{isAdmin && <button type="button" aria-label={`ลบงาน ${task.sequence}`} onClick={() => void removeTask(task)}><X size={15} /></button>}</div></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      ) : <div className="staff-module-empty">ยังไม่มีงานในแผนวันนี้ {isAdmin && "เลือก “เพิ่มงานในแผน” เพื่อเริ่มจัดลำดับงาน"}</div>}

      {taskEditor && <div className="staff-modal-overlay" onClick={() => setTaskEditor(null)}><form className="staff-modal work-plan-modal" onSubmit={createTask} onClick={(event) => event.stopPropagation()}><header><h3>เพิ่มงานในแผนประจำวันที่ {date}</h3><button type="button" aria-label="ปิด" onClick={() => setTaskEditor(null)}><X size={18} /></button></header><label>เลือก SOP ที่เผยแพร่แล้ว<select required name="sopId" value={taskEditor.sopId} onChange={(event) => setTaskEditor({ ...taskEditor, sopId: event.target.value })}><option value="">เลือก SOP</option>{activeSops.map((sop) => <option key={sop.id} value={sop.id}>{sop.publishedTitle || sop.title} · v{sop.latestVersion}</option>)}</select></label><label>เริ่มงานหลังงานที่เลือกเสร็จ (เว้นว่างหากทำขนานได้)<select multiple name="dependsOnTaskIds" value={taskEditor.dependsOnTaskIds ?? []} onChange={(event) => setTaskEditor({ ...taskEditor, dependsOnTaskIds: [...event.target.selectedOptions].map((option) => option.value) })}>{tasks.map((task) => <option key={task.id} value={task.id}>ลำดับ {task.sequence} · {task.sopSnapshot.title} ({WORK_PLAN_STATUSES[task.status]})</option>)}</select></label><fieldset><legend>ผู้รับผิดชอบ (เลือกได้หลายคน)</legend><div className="work-plan-assignees">{activeStaff.map((person) => <label key={person.id}><input type="checkbox" name="assignedStaffIds" value={person.id} />{person.nickname} · {person.position === "checker" ? "Checker" : person.position === "packer" ? "Packer" : "หัวหน้า"}</label>)}</div></fieldset><label>เวลาเป้าหมาย<input name="targetTime" type="time" /></label><label>หมายเหตุ<textarea name="note" maxLength="500" /></label><footer><button type="button" onClick={() => setTaskEditor(null)}>ยกเลิก</button><button className="primary-action" disabled={saving || !activeSops.length}><Plus size={15} /> เพิ่มตามลำดับ {nextTaskSequence(tasks)}</button></footer></form></div>}
    </div>
  );
}
