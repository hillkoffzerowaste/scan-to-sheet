import React, { useEffect, useState } from "react";
import { BookOpen, ClipboardList } from "lucide-react";
import {
  listStaffSops,
  listWorkPlanTasks,
  WORK_PLANNING_QUERY_LIMITS,
} from "../workPlanningService.js";
import WorkPlanBoard from "./WorkPlanBoard.jsx";
import SopLibrary from "./SopLibrary.jsx";
import { findStaffModule } from "../staffModules.js";

const PLANNING_MODULES = findStaffModule("planning").children;
const CHILD_MODULES = {
  plan: WorkPlanBoard,
  sops: SopLibrary,
};

export default function WorkPlanningModule({ date, staff, isAdmin, firebaseUser, onMessage }) {
  const [activeChildId, setActiveChildId] = useState(PLANNING_MODULES[0].id);
  const [sops, setSops] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const ActiveChild = CHILD_MODULES[activeChildId] ?? CHILD_MODULES[PLANNING_MODULES[0].id];

  async function reload() {
    setError("");
    try {
      const [nextSops, nextTasks] = await Promise.all([listStaffSops(), listWorkPlanTasks(date)]);
      setSops(nextSops);
      setTasks(nextTasks.slice().sort((a, b) => Number(a.sequence) - Number(b.sequence)));
      if (nextSops.length >= WORK_PLANNING_QUERY_LIMITS.sops || nextTasks.length >= WORK_PLANNING_QUERY_LIMITS.tasks) {
        setError("แสดงข้อมูลได้ไม่ครบเพราะถึงขีดจำกัดรายการ กรุณาแจ้ง Admin ให้จัดเก็บข้อมูลเก่า");
      }
    } catch {
      setError("โหลดแผนงานและ SOP ไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setTasks([]);
    void reload();
  }, [date, firebaseUser?.uid]);

  function handleError(errorOrMessage) {
    if (typeof errorOrMessage === "string") {
      setError(errorOrMessage);
      return;
    }
    if (errorOrMessage?.code === "STAFF_SOP_INVALID") setError("กรุณากรอกชื่อ SOP และชื่อขั้นตอนให้ครบ (สูงสุด 30 ขั้น)");
    else if (errorOrMessage?.code === "STAFF_SOP_LIMIT") setError("คลัง SOP มีครบ 100 รายการแล้ว กรุณาปิดใช้หรือจัดเก็บ SOP เก่าก่อน");
    else if (errorOrMessage?.code === "STAFF_WORK_PLAN_TASK_LIMIT") setError("แผนวันนี้มีครบ 200 งานแล้ว กรุณาแบ่งแผนหรือจัดเก็บงานเก่าก่อน");
    else if (errorOrMessage?.code === "STAFF_WORK_PLAN_ORDER_LIMIT") setError("รายการงานเกินขอบเขตที่จัดลำดับได้ กรุณาแบ่งแผนงาน");
    else if (errorOrMessage?.code === "STAFF_WORK_PLAN_STEPS_INCOMPLETE") setError("ทำขั้นตอนบังคับของ SOP ให้ครบก่อนปิดงาน");
    else if (errorOrMessage?.code === "STAFF_WORK_PLAN_PREREQUISITE_INCOMPLETE") setError("งานที่กำหนดให้ทำก่อนหน้ายังไม่เสร็จ");
    else if (errorOrMessage?.code === "STAFF_WORK_PLAN_HAS_DEPENDENTS") setError("งานนี้ยังเป็นเงื่อนไขก่อนเริ่มของงานอื่น กรุณาปรับแผนงานที่ตามหลังก่อนลบ");
    else if (errorOrMessage?.code === "STAFF_WORK_PLAN_STEP_UNCHANGED") setError("ขั้นตอนนี้ไม่มีการเปลี่ยนแปลง กรุณาลองใหม่");
    else if (errorOrMessage?.code === "permission-denied") setError("ไม่มีสิทธิ์บันทึกข้อมูล กรุณาติดต่อ Admin");
    else setError("บันทึกข้อมูลไม่สำเร็จ กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง");
  }

  return (
    <section className="staff-module" aria-labelledby="work-planning-title">
      <header className="staff-module-header">
        <div><p className="eyebrow">โมดูลย่อย · แผนปฏิบัติงาน</p><h3 id="work-planning-title">แผนงานและ SOP</h3><p>จัดลำดับงานของวันที่เลือก และติดตามตาม SOP ฉบับที่เริ่มใช้จริง</p></div>
      </header>
      <nav className="staff-submodule-tabs" aria-label="ส่วนย่อยของแผนงาน">
        {PLANNING_MODULES.map((module) => <button key={module.id} className={activeChildId === module.id ? "active" : ""} aria-current={activeChildId === module.id ? "page" : undefined} onClick={() => setActiveChildId(module.id)}>{module.id === "plan" ? <ClipboardList size={16} /> : <BookOpen size={16} />}{module.label}</button>)}
      </nav>
      {error && <div className="staff-module-alert" role="status">{error}</div>}
      {loading ? <p className="staff-module-empty">กำลังโหลดข้อมูล…</p> : <ActiveChild
        date={date}
        tasks={tasks}
        sops={sops}
        staff={staff}
        isAdmin={isAdmin}
        firebaseUser={firebaseUser}
        onRefresh={reload}
        onMessage={onMessage}
        onError={handleError}
      />}
    </section>
  );
}
