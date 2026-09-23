import React, { useState } from "react";
import { BookOpen, Plus, Save, Send, X } from "lucide-react";
import {
  publishStaffSop,
  saveStaffSopDraft,
  setStaffSopActive,
  WORK_PLANNING_QUERY_LIMITS,
} from "../workPlanningService.js";
import { validateSopDraft } from "../workPlanning.js";

function createStep() {
  return { id: crypto.randomUUID(), title: "", instruction: "", verification: "", required: true };
}

function newSop() {
  return { title: "", description: "", latestVersion: 0, active: true, steps: [createStep()] };
}

function editSop(sop) {
  return {
    id: sop.id,
    title: sop.title ?? "",
    description: sop.description ?? "",
    latestVersion: Number(sop.latestVersion ?? 0),
    active: sop.active !== false,
    steps: (sop.draftSteps ?? []).map((step) => ({ ...step })),
  };
}

export default function SopLibrary({ sops, isAdmin, firebaseUser, onRefresh, onMessage, onError }) {
  const [editor, setEditor] = useState(null);
  const [saving, setSaving] = useState(false);
  const sortedSops = sops.slice().sort((a, b) => String(a.publishedTitle || a.title).localeCompare(String(b.publishedTitle || b.title), "th"));

  function updateStep(stepId, changes) {
    setEditor((current) => ({
      ...current,
      steps: current.steps.map((step) => step.id === stepId ? { ...step, ...changes } : step),
    }));
  }

  async function save(publish) {
    const errors = validateSopDraft(editor);
    if (errors.length) {
      onError?.("กรุณากรอกชื่อ SOP และชื่อขั้นตอนให้ครบก่อนบันทึก");
      return;
    }
    setSaving(true);
    try {
      if (publish) {
        const result = await publishStaffSop(editor, firebaseUser);
        onMessage?.(`เผยแพร่ SOP เวอร์ชัน ${result.version} แล้ว`);
        setEditor(null);
      } else {
        const id = await saveStaffSopDraft(editor, firebaseUser);
        setEditor((current) => ({ ...current, id }));
        onMessage?.("บันทึกฉบับร่าง SOP แล้ว");
      }
      await onRefresh?.();
    } catch (error) {
      if (error?.code === "STAFF_SOP_LIMIT") onError?.("คลัง SOP มีครบ 100 รายการแล้ว กรุณาปิดใช้หรือจัดเก็บ SOP เก่าก่อน");
      else if (error?.code === "permission-denied") onError?.("ไม่มีสิทธิ์บันทึก SOP กรุณาติดต่อ Admin");
      else onError?.("บันทึก SOP ไม่สำเร็จ กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(sop) {
    try {
      await setStaffSopActive(sop.id, sop.active === false, firebaseUser);
      await onRefresh?.();
    } catch {
      onError?.("เปลี่ยนสถานะ SOP ไม่สำเร็จ กรุณาลองใหม่");
    }
  }

  return (
    <div className="staff-sop-module">
      <div className="staff-module-header">
        <div><h4>คลังขั้นตอนมาตรฐาน</h4><p>แต่ละงานที่เริ่มแล้วจะยึดสำเนา SOP และเวอร์ชันเดิมไว้</p></div>
        {isAdmin && <button className="primary-action" type="button" disabled={sops.length >= WORK_PLANNING_QUERY_LIMITS.sops} onClick={() => setEditor(newSop())}><Plus size={16} /> สร้าง SOP</button>}
      </div>
      <div className="sop-library">
        {sortedSops.length ? sortedSops.map((sop) => (
          <article className={`sop-card ${sop.active === false ? "inactive" : ""}`} key={sop.id}>
            <div><span className={`staff-status ${sop.active === false ? "status-off" : "status-working"}`}>{sop.active === false ? "ปิดใช้" : Number(sop.latestVersion) > 0 ? "เผยแพร่" : "ฉบับร่าง"}</span><h5>{sop.publishedTitle || sop.title}</h5><p>{sop.publishedDescription || sop.description || "ไม่มีรายละเอียดเพิ่มเติม"}</p><small>เวอร์ชันล่าสุด: {sop.latestVersion || "ยังไม่เผยแพร่"} · {sop.draftSteps?.length ?? 0} ขั้นตอนในฉบับร่าง</small></div>
            {isAdmin && <div className="sop-card-actions"><button type="button" onClick={() => setEditor(editSop(sop))}>แก้ไขฉบับร่าง</button><button type="button" onClick={() => void toggleActive(sop)}>{sop.active === false ? "เปิดใช้" : "ปิดใช้"}</button></div>}
          </article>
        )) : <div className="staff-module-empty">ยังไม่มี SOP {isAdmin && "สร้าง SOP เพื่อกำหนดขั้นตอนการทำงานมาตรฐาน"}</div>}
      </div>

      {editor && <div className="staff-modal-overlay" onClick={() => setEditor(null)}><form className="staff-modal sop-editor-modal" onSubmit={(event) => { event.preventDefault(); void save(false); }} onClick={(event) => event.stopPropagation()}><header><h3>{editor.id ? "แก้ไขฉบับร่าง SOP" : "สร้าง SOP ใหม่"}</h3><button type="button" aria-label="ปิด" onClick={() => setEditor(null)}><X size={18} /></button></header><label>ชื่อ SOP<input maxLength="120" required value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></label><label>วัตถุประสงค์ / ขอบเขต<textarea maxLength="1000" value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} /></label><div className="sop-editor-steps"><div><h4>ขั้นตอนตามลำดับ</h4><span>{editor.steps.length}/30 ขั้น</span></div>{editor.steps.map((step, index) => <fieldset className="sop-step-editor" key={step.id}><legend>ขั้นที่ {index + 1}</legend><button type="button" aria-label={`ลบขั้นที่ ${index + 1}`} disabled={editor.steps.length === 1} onClick={() => setEditor({ ...editor, steps: editor.steps.filter((item) => item.id !== step.id) })}><X size={15} /></button><label>ชื่อขั้นตอน<input required maxLength="120" value={step.title} onChange={(event) => updateStep(step.id, { title: event.target.value })} /></label><label>วิธีปฏิบัติ<textarea maxLength="1000" value={step.instruction} onChange={(event) => updateStep(step.id, { instruction: event.target.value })} /></label><label>จุดตรวจ/ผลลัพธ์ที่ต้องได้<input maxLength="500" value={step.verification} onChange={(event) => updateStep(step.id, { verification: event.target.value })} /></label><label className="sop-required-step"><input type="checkbox" checked={step.required !== false} onChange={(event) => updateStep(step.id, { required: event.target.checked })} />ขั้นตอนบังคับ</label></fieldset>)}<button type="button" disabled={editor.steps.length >= 30} onClick={() => setEditor({ ...editor, steps: [...editor.steps, createStep()] })}><Plus size={15} /> เพิ่มขั้นตอน</button></div><footer><button type="button" onClick={() => setEditor(null)}>ยกเลิก</button><button type="submit" disabled={saving}><Save size={15} /> บันทึกฉบับร่าง</button><button type="button" className="primary-action" disabled={saving || validateSopDraft(editor).length > 0} onClick={() => void save(true)}><Send size={15} /> เผยแพร่ v{Number(editor.latestVersion) + 1}</button></footer></form></div>}
    </div>
  );
}
