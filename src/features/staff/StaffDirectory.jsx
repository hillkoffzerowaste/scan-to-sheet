import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Copy,
  GripVertical,
  Mail,
  Megaphone,
  Pencil,
  Phone,
  Plus,
  Search,
  Star,
  UserRound,
  Users,
  X,
} from "lucide-react";
import {
  buildDutyLabelsByStaff,
  buildPackingRoomTeam,
  buildPackerOptions,
  buildWorkforceSummary,
  filterDirectoryStaff,
  groupActiveStaff,
  mergeAssignments,
  reorderStaffWithinPosition,
  resolvePackingNotice,
  resolveDailyStatus,
  staffMissingFields,
  staffSaveErrorMessage,
  validateStaffInput,
} from "./staffDirectory.js";
import {
  copyDailyAssignments,
  createStaffMemberId,
  deleteDailyAssignment,
  getStaffAdminStatus,
  getPackingRoomNotice,
  getDailyLead,
  listDailyAssignments,
  listDailyStatuses,
  listDutyTypes,
  listStaffMembers,
  listStaffPrivateNotes,
  listStaffPrivateContacts,
  removeStaffPhoto,
  saveDailyAssignment,
  saveDailyLead,
  saveDailyStatus,
  saveDutyType,
  savePackingRoomNotice,
  saveStaffMember,
  saveStaffOrder,
  uploadStaffPhoto,
} from "./staffService.js";

const POSITION_LABELS = {
  leader: "หัวหน้า",
  checker: "Checker",
  packer: "Packer",
};
const STATUS_LABELS = {
  working: "ปฏิบัติงาน",
  leave: "ลา",
  off: "หยุด",
  outside: "ออกนอกพื้นที่",
};
const EMPTY_MEMBER = {
  employeeId: "",
  fullName: "",
  nickname: "",
  position: "packer",
  phone: "",
  lineId: "",
  email: "",
  internalNote: "",
  active: true,
  sortOrder: 0,
  photoUrl: "",
  photoPath: "",
};

function thaiDate(date) {
  if (!date) return "กรุณาเลือกวันที่";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "full",
    timeZone: "Asia/Bangkok",
  }).format(new Date(`${date}T00:00:00+07:00`));
}

function initials(person) {
  return (person.nickname || person.fullName || "?").trim().slice(0, 2);
}

function updatedLabel(value) {
  const date = value?.toDate?.();
  return date
    ? new Intl.DateTimeFormat("th-TH", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Bangkok",
      }).format(date)
    : "";
}

function bangkokDateKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(
    new Date()
  );
}

export default function StaffDirectory({
  firebaseUser,
  onPackerOptionsChange,
}) {
  const [staff, setStaff] = useState([]);
  const [dutyTypes, setDutyTypes] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [dailyStatuses, setDailyStatuses] = useState(new Map());
  const [dailyLeadId, setDailyLeadId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [section, setSection] = useState("directory");
  const [date, setDate] = useState(bangkokDateKey);
  const [queryText, setQueryText] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [positionFilter, setPositionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dutyFilter, setDutyFilter] = useState("all");
  const [editingMember, setEditingMember] = useState(null);
  const [editingAssignment, setEditingAssignment] = useState(null);
  const [dutyName, setDutyName] = useState("");
  const [packingNotice, setPackingNotice] = useState(() =>
    resolvePackingNotice("")
  );
  const [editingNotice, setEditingNotice] = useState(false);
  const [noticeDraft, setNoticeDraft] = useState("");
  const [message, setMessage] = useState("");
  const [copying, setCopying] = useState(false);
  const [draggedStaffId, setDraggedStaffId] = useState("");
  const [savingOrder, setSavingOrder] = useState(false);

  async function reloadBase(includePrivate = isAdmin) {
    const [publicMembers, duties, privateNotes, privateContacts, notice] = await Promise.all([
      listStaffMembers(),
      listDutyTypes(),
      includePrivate ? listStaffPrivateNotes() : Promise.resolve(new Map()),
      includePrivate ? listStaffPrivateContacts() : Promise.resolve(new Map()),
      getPackingRoomNotice(),
    ]);
    const members = publicMembers.map((person) => ({
      ...person,
      internalNote: privateNotes.get(person.id),
      ...(privateContacts.has(person.id)
        ? {
            phone: privateContacts.get(person.id).phone ?? "",
            lineId: privateContacts.get(person.id).lineId ?? "",
            email: privateContacts.get(person.id).email ?? "",
          }
        : {}),
    }));
    setStaff(members);
    setDutyTypes(duties);
    setPackingNotice(resolvePackingNotice(notice));
    try {
      onPackerOptionsChange?.(buildPackerOptions(members), members.length);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function reloadDaily(selectedDate = date) {
    const [items, statuses, lead] = await Promise.all([
      listDailyAssignments(selectedDate),
      listDailyStatuses(selectedDate),
      getDailyLead(selectedDate),
    ]);
    setAssignments(items);
    setDailyStatuses(
      new Map(statuses.map((item) => [item.staffId, item.status]))
    );
    setDailyLeadId(lead?.staffId ?? "");
  }

  useEffect(() => {
    if (!firebaseUser) return;
    void getStaffAdminStatus(firebaseUser.uid)
      .then(async (admin) => {
        setIsAdmin(admin);
        await reloadBase(admin);
      })
      .catch(() => setMessage("โหลดข้อมูลทำเนียบไม่สำเร็จ"));
  }, [firebaseUser?.uid]);

  useEffect(() => {
    if (firebaseUser) void reloadDaily(date);
  }, [date, firebaseUser?.uid]);

  const staffById = useMemo(
    () => new Map(staff.map((person) => [person.id, person])),
    [staff]
  );
  const dutyById = useMemo(
    () => new Map(dutyTypes.map((item) => [item.id, item])),
    [dutyTypes]
  );
  const dutyLabelsByStaff = useMemo(
    () => buildDutyLabelsByStaff(assignments, dutyById),
    [assignments, dutyById]
  );
  const activeOrVisibleStaff = useMemo(
    () => staff.filter((person) => showInactive || person.active !== false),
    [staff, showInactive]
  );
  const visibleStaff = useMemo(
    () =>
      filterDirectoryStaff(activeOrVisibleStaff, {
        query: queryText,
        position: positionFilter,
        status: statusFilter,
        duty: dutyFilter,
        statuses: dailyStatuses,
        duties: dutyLabelsByStaff,
      }),
    [
      activeOrVisibleStaff,
      queryText,
      positionFilter,
      statusFilter,
      dutyFilter,
      dailyStatuses,
      dutyLabelsByStaff,
    ]
  );
  const groups = groupActiveStaff(
    showInactive
      ? visibleStaff.map((person) => ({ ...person, active: true }))
      : visibleStaff
  );
  const packingRoomTeam = buildPackingRoomTeam(groups);
  const workforceSummary = useMemo(
    () => buildWorkforceSummary(staff, dailyStatuses, dutyLabelsByStaff),
    [staff, dailyStatuses, dutyLabelsByStaff]
  );

  async function updateDailyStatus(person, status) {
    try {
      await saveDailyStatus({ date, staffId: person.id, status }, firebaseUser);
      await reloadDaily();
      setMessage(`บันทึกสถานะของ ${person.nickname} แล้ว`);
    } catch {
      setMessage("บันทึกสถานะประจำวันไม่สำเร็จ กรุณาลองใหม่");
    }
  }

  async function reorderTeam(targetId) {
    if (!draggedStaffId || draggedStaffId === targetId || savingOrder) return;
    const dragged = staffById.get(draggedStaffId);
    const target = staffById.get(targetId);
    if (!dragged || !target || dragged.position !== target.position) {
      setMessage("จัดลำดับได้เฉพาะพนักงานตำแหน่งเดียวกัน");
      setDraggedStaffId("");
      return;
    }
    setSavingOrder(true);
    try {
      const next = reorderStaffWithinPosition(staff, draggedStaffId, targetId);
      const orderedPosition = next.filter(
        (person) => person.position === dragged.position
      );
      await saveStaffOrder(orderedPosition, firebaseUser);
      setStaff(next);
      setMessage("บันทึกลำดับพนักงานแล้ว");
    } catch {
      setMessage("บันทึกลำดับพนักงานไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSavingOrder(false);
      setDraggedStaffId("");
    }
  }

  function staffCard(person, label) {
    const dutyLabels = dutyLabelsByStaff.get(person.id) ?? [];
    const dailyStatus = resolveDailyStatus(person.id, dailyStatuses);
    const missingFields = staffMissingFields(person, dutyLabels);
    const canReorder = isAdmin && ["checker", "packer"].includes(person.position);
    return (
      <article
        className={`staff-card status-${dailyStatus} ${person.active === false ? "inactive" : ""}`}
        key={person.id}
        draggable={canReorder && !savingOrder}
        onDragStart={() => setDraggedStaffId(person.id)}
        onDragOver={(event) => canReorder && event.preventDefault()}
        onDrop={() => void reorderTeam(person.id)}
      >
        {canReorder && (
          <span className="staff-drag-handle" title="ลากเพื่อจัดลำดับ">
            <GripVertical size={15} />
          </span>
        )}
        <div className="staff-photo">
          {person.photoUrl ? (
            <img src={person.photoUrl} alt={`รูปของ ${person.fullName}`} />
          ) : (
            <span>{initials(person)}</span>
          )}
        </div>
        <div className="staff-card-body">
          <div className="staff-card-title">
            <div>
              <strong>{person.nickname}</strong>
              <p>{person.fullName}</p>
              {person.employeeId && (
                <small>รหัสพนักงาน: {person.employeeId}</small>
              )}
            </div>
            <span className="staff-position">{label}</span>
          </div>
          <div className="staff-card-badges">
            <span className={`staff-status status-${dailyStatus}`}>
              {STATUS_LABELS[dailyStatus]}
            </span>
            {dailyLeadId === person.id && (
              <span className="staff-lead-badge"><Star size={13} /> ผู้ช่วยหัวหน้าวันนี้</span>
            )}
          </div>
          {isAdmin && missingFields.length > 0 && (
            <div className="staff-incomplete" title={missingFields.join(", ")}>
              <AlertTriangle size={14} /> ข้อมูลไม่ครบ: {missingFields.join(", ")}
            </div>
          )}
          {isAdmin && person.active !== false && (
            <label className="staff-status-editor">
              สถานะวันที่เลือก
              <select
                value={dailyStatus}
                onChange={(event) => void updateDailyStatus(person, event.target.value)}
              >
                {Object.entries(STATUS_LABELS).map(([value, text]) => (
                  <option key={value} value={value}>{text}</option>
                ))}
              </select>
            </label>
          )}
          <div className="staff-today-duty">
            <strong>
              <CalendarDays size={14} /> หน้าที่วันนี้
            </strong>
            {dutyLabels.length ? (
              <ul>
                {dutyLabels.map((dutyLabel, index) => (
                  <li key={`${person.id}-duty-${index}`}>{dutyLabel}</li>
                ))}
              </ul>
            ) : (
              <p>ยังไม่ได้กำหนดหน้าที่</p>
            )}
          </div>
          <div className={`staff-contact ${isAdmin ? "private-visible" : "masked"}`}>
            {person.phone && (
              isAdmin ? <a href={`tel:${person.phone}`}>
                <Phone size={15} />
                {person.phone}
              </a> : <span><Phone size={15} />{person.phone}</span>
            )}
            {person.lineId && (
              isAdmin ? <button
                onClick={() => navigator.clipboard?.writeText(person.lineId)}
              >
                LINE: {person.lineId}
              </button> : <span>LINE: {person.lineId}</span>
            )}
            {person.email && (
              isAdmin ? <a href={`mailto:${person.email}`}>
                <Mail size={15} />
                {person.email}
              </a> : <span><Mail size={15} />{person.email}</span>
            )}
          </div>
          {isAdmin && (
            <button className="staff-edit" onClick={() => setEditingMember(person)}>
              <Pencil size={15} /> แก้ไข
            </button>
          )}
        </div>
      </article>
    );
  }

  async function submitMember(event) {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const member = {
        ...editingMember,
        previousEmployeeId: editingMember.employeeId,
        employeeId: String(form.get("employeeId") ?? "").trim(),
        fullName: form.get("fullName"),
        nickname: form.get("nickname"),
        position: form.get("position"),
        phone: form.get("phone"),
        lineId: form.get("lineId"),
        email: form.get("email"),
        internalNote: form.get("internalNote"),
        active: form.get("active") === "on",
        sortOrder: Number(form.get("sortOrder") || 0),
      };
      const validationErrors = validateStaffInput(member, staff);
      if (validationErrors.includes("employeeId")) {
        setMessage("รหัสพนักงานนี้ถูกใช้งานแล้ว");
        return;
      }
      if (validationErrors.length) {
        setMessage("กรุณากรอกชื่อจริง ชื่อเล่น และตำแหน่งให้ครบ");
        return;
      }
      buildPackerOptions([
        ...staff.filter((person) => person.id !== member.id),
        member,
      ]);
      const id = member.id || createStaffMemberId();
      const file = form.get("photo");
      let nextMember = { ...member, id };
      let photoCleanupFailed = false;
      if (file?.size) {
        const photo = await uploadStaffPhoto(id, file);
        try {
          nextMember = { ...nextMember, ...photo };
          await saveStaffMember(nextMember, firebaseUser);
        } catch (error) {
          try {
            await removeStaffPhoto(photo.photoPath);
          } catch {
            setMessage(
              "บันทึกข้อมูลไม่สำเร็จและล้างไฟล์รูปชั่วคราวไม่ได้ กรุณาแจ้ง Admin"
            );
            return;
          }
          throw error;
        }
      } else {
        await saveStaffMember(nextMember, firebaseUser);
      }
      if (member.photoPath && member.photoPath !== nextMember.photoPath) {
        try {
          await removeStaffPhoto(member.photoPath);
        } catch {
          photoCleanupFailed = true;
        }
      }
      setEditingMember(null);
      setMessage(
        photoCleanupFailed
          ? "บันทึกข้อมูลแล้ว แต่ลบไฟล์รูปเดิมไม่สำเร็จ"
          : "บันทึกข้อมูลพนักงานแล้ว"
      );
      await reloadBase();
    } catch (error) {
      setMessage(staffSaveErrorMessage(error));
    }
  }

  async function submitAssignment(event) {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      await saveDailyAssignment(
        {
          ...editingAssignment,
          date,
          staffId: form.get("staffId"),
          dutyTypeId: form.get("dutyTypeId"),
          note: form.get("note"),
        },
        firebaseUser
      );
      setEditingAssignment(null);
      await reloadDaily();
      setMessage("บันทึกหน้าที่ประจำวันแล้ว");
    } catch {
      setMessage("บันทึกหน้าที่ประจำวันไม่สำเร็จ กรุณาลองใหม่");
    }
  }

  async function copyFrom(offsetDays) {
    if (!date || copying) return;
    setCopying(true);
    try {
      const source = new Date(`${date}T00:00:00+07:00`);
      source.setDate(source.getDate() - offsetDays);
      const sourceDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Bangkok",
      }).format(source);
      const items = await listDailyAssignments(sourceDate);
      let replaceIds = [];
      if (assignments.length) {
        const replace = window.confirm(
          "วันที่ปลายทางมีรายการอยู่แล้ว กด “ตกลง” เพื่อแทนที่ทั้งหมด หรือ “ยกเลิก” เพื่อเลือกการรวมรายการ"
        );
        if (replace) replaceIds = assignments.map((item) => item.id);
        else if (
          !window.confirm("ต้องการรวมหน้าที่ที่คัดลอกเข้ากับรายการเดิมหรือไม่?")
        )
          return;
      }
      const copiedItems = replaceIds.length
        ? items
        : mergeAssignments(assignments, items);
      await copyDailyAssignments({
        date,
        assignments: copiedItems,
        replaceIds,
        user: firebaseUser,
      });
      await reloadDaily();
      setMessage(`คัดลอกหน้าที่จาก ${sourceDate} แล้ว`);
    } catch {
      setMessage("คัดลอกหน้าที่ไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setCopying(false);
    }
  }

  return (
    <section className="staff-page" aria-labelledby="staff-title">
      <header className="staff-page-header">
        <div>
          <p className="eyebrow">ฝ่ายแพ็คสินค้า</p>
          <h2 id="staff-title">แผนผังพนักงานห้องแพ็ค</h2>
          <p>รายชื่อ ช่องทางติดต่อ และหน้าที่ประจำวันของเจ้าหน้าที่</p>
        </div>
        {isAdmin && section === "directory" && (
          <button
            className="primary-action"
            onClick={() => setEditingMember(EMPTY_MEMBER)}
          >
            <Plus size={17} /> เพิ่มพนักงาน
          </button>
        )}
      </header>
      <div className="staff-section-tabs">
        <button
          className={section === "directory" ? "active" : ""}
          onClick={() => setSection("directory")}
        >
          <Users size={17} /> แผนผังพนักงาน
        </button>
        <button
          className={section === "schedule" ? "active" : ""}
          onClick={() => setSection("schedule")}
        >
          <CalendarDays size={17} /> หน้าที่ประจำวัน
        </button>
      </div>
      {message && (
        <div className="staff-message" role="status">
          {message}
          <button aria-label="ปิดข้อความ" onClick={() => setMessage("")}>
            <X size={15} />
          </button>
        </div>
      )}

      {section === "directory" ? (
        <>
          <div className="staff-summary" aria-label="สรุปกำลังคนวันที่เลือก">
            {[
              ["ทั้งหมด", workforceSummary.total],
              ["ปฏิบัติงาน", workforceSummary.working],
              ["ลา", workforceSummary.leave],
              ["หยุด", workforceSummary.off],
              ["ออกนอกพื้นที่", workforceSummary.outside],
              ["ยังไม่มีหน้าที่", workforceSummary.unassigned],
            ].map(([label, value]) => (
              <div key={label}><span>{label}</span><strong>{value}</strong></div>
            ))}
          </div>
          <div className="staff-toolbar">
            <label className="staff-search">
              <Search size={17} />
              <input
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder="ค้นหาชื่อ ตำแหน่ง หรือหน้าที่วันที่เลือก"
              />
            </label>
            <label className="staff-filter-control">
              วันที่
              <input type="date" required value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </label>
            <label className="staff-filter-control">
              ตำแหน่ง
              <select value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)}>
                <option value="all">ทั้งหมด</option>
                <option value="leader">หัวหน้า</option>
                <option value="checker">Checker</option>
                <option value="packer">Packer</option>
              </select>
            </label>
            <label className="staff-filter-control">
              สถานะ
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">ทั้งหมด</option>
                {Object.entries(STATUS_LABELS).map(([value, text]) => (
                  <option key={value} value={value}>{text}</option>
                ))}
              </select>
            </label>
            <label className="staff-filter-control">
              หน้าที่
              <select value={dutyFilter} onChange={(e) => setDutyFilter(e.target.value)}>
                <option value="all">ทั้งหมด</option>
                <option value="assigned">มีหน้าที่แล้ว</option>
                <option value="unassigned">ยังไม่มีหน้าที่</option>
              </select>
            </label>
            <button className="staff-report-button" onClick={() => window.print()}>
              <BarChart3 size={16} /> รายงานประจำวัน
            </button>
            {isAdmin && (
              <label className="staff-filter-control staff-lead-select">
                ผู้ช่วยหัวหน้า
                <select
                  value={dailyLeadId}
                  onChange={async (event) => {
                    try {
                      await saveDailyLead(date, event.target.value, firebaseUser);
                      setDailyLeadId(event.target.value);
                      setMessage("บันทึกผู้ช่วยหัวหน้าประจำวันแล้ว");
                    } catch {
                      setMessage("บันทึกผู้ช่วยหัวหน้าไม่สำเร็จ กรุณาลองใหม่");
                    }
                  }}
                >
                  <option value="">ยังไม่กำหนด</option>
                  {staff
                    .filter((person) => person.active !== false && ["checker", "packer"].includes(person.position))
                    .map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.nickname} — {POSITION_LABELS[person.position]}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {isAdmin && (
              <label className="staff-checkbox">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                />{" "}
                แสดงผู้ไม่ได้ปฏิบัติงาน
              </label>
            )}
          </div>
          <div className="staff-org-chart" aria-label="แผนผังพนักงานห้องแพ็ค">
            {groups.leader.length > 0 && (
              <div className="staff-leader-overview">
                <section className="staff-org-level staff-org-leader">
                  <h3>
                    หัวหน้า <span>{groups.leader.length} คน</span>
                  </h3>
                  <div className="staff-grid">
                    {groups.leader.map((person) => staffCard(person, "หัวหน้า"))}
                  </div>
                </section>
                <aside className="packing-notice" aria-labelledby="packing-notice-title">
                  <header>
                    <div>
                      <span className="packing-notice-icon" aria-hidden="true">
                        <Megaphone size={18} />
                      </span>
                      <div>
                        <p>ประกาศประจำห้องแพ็ค</p>
                        <h3 id="packing-notice-title">การจัดการ ระเบียบ และกฎข้อบังคับ</h3>
                      </div>
                    </div>
                    {isAdmin && (
                      <button
                        className="staff-edit"
                        onClick={() => {
                          setNoticeDraft(packingNotice);
                          setEditingNotice(true);
                        }}
                      >
                        <Pencil size={14} /> แก้ไขประกาศ
                      </button>
                    )}
                  </header>
                  <p className="packing-notice-content">{packingNotice}</p>
                </aside>
              </div>
            )}
            {packingRoomTeam.length > 0 && (
              <section className="staff-org-level staff-org-team">
                <h3>
                  Checker และ Packer <span>{packingRoomTeam.length} คน</span>
                </h3>
                <div className="staff-grid">
                  {packingRoomTeam.map((person) =>
                    staffCard(
                      person,
                      person.position === "checker" ? "Checker" : "Packer"
                    )
                  )}
                </div>
              </section>
            )}
          </div>
          {!visibleStaff.length && (
            <div className="staff-empty">
              <UserRound size={32} />
              <p>ไม่พบรายชื่อพนักงาน</p>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="schedule-toolbar">
            <label>
              วันที่{" "}
              <input
                type="date"
                required
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
            </label>
            <strong>{thaiDate(date)}</strong>
            {isAdmin && (
              <div>
                <button onClick={() => copyFrom(1)}>
                  <Copy size={16} /> คัดลอกจากวันก่อน
                </button>
                <button onClick={() => copyFrom(7)}>
                  <Copy size={16} /> คัดลอกจากสัปดาห์ก่อน
                </button>
                <button
                  className="primary-action"
                  onClick={() => setEditingAssignment({})}
                >
                  <Plus size={16} /> จัดเวร
                </button>
              </div>
            )}
          </div>
          {isAdmin && (
            <>
              <form
                className="duty-type-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!dutyName.trim()) return;
                  await saveDutyType(
                    {
                      name: dutyName,
                      active: true,
                      sortOrder: dutyTypes.length,
                    },
                    firebaseUser
                  );
                  setDutyName("");
                  await reloadBase();
                }}
              >
                <label>
                  เพิ่มประเภทงาน{" "}
                  <input
                    value={dutyName}
                    onChange={(e) => setDutyName(e.target.value)}
                    placeholder="เช่น แพ็คสินค้าโซน A"
                  />
                </label>
                <button>เพิ่ม</button>
              </form>
              <div className="duty-type-list">
                {dutyTypes.map((duty) => (
                  <span
                    key={duty.id}
                    className={duty.active === false ? "inactive" : ""}
                  >
                    <button
                      onClick={async () => {
                        const name = window.prompt(
                          "แก้ไขชื่อประเภทงาน",
                          duty.name
                        );
                        if (name === null || !name.trim()) return;
                        await saveDutyType({ ...duty, name }, firebaseUser);
                        await reloadBase();
                      }}
                    >
                      {duty.name}
                    </button>
                    <button
                      onClick={async () => {
                        await saveDutyType(
                          { ...duty, active: duty.active === false },
                          firebaseUser
                        );
                        await reloadBase();
                      }}
                    >
                      {duty.active === false ? "เปิดใช้" : "ปิดใช้"}
                    </button>
                  </span>
                ))}
              </div>
            </>
          )}
          <div className="assignment-list">
            {assignments.map((item) => {
              const person = staffById.get(item.staffId);
              return (
                <article key={item.id}>
                  <div className="assignment-avatar">
                    {initials(person || {})}
                  </div>
                  <div>
                    <strong>
                      {person
                        ? `${person.nickname} — ${person.fullName}`
                        : "พนักงานเดิม"}
                    </strong>
                    <p>
                      {dutyById.get(item.dutyTypeId)?.name || "ประเภทงานเดิม"}
                      {item.note ? ` · ${item.note}` : ""}
                    </p>
                    {updatedLabel(item.updatedAt) && (
                      <small>
                        แก้ไขล่าสุด {updatedLabel(item.updatedAt)}
                        {item.updatedBy?.name || item.updatedBy?.email
                          ? ` โดย ${
                              item.updatedBy.name || item.updatedBy.email
                            }`
                          : ""}
                      </small>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="assignment-actions">
                      <button onClick={() => setEditingAssignment(item)}>
                        แก้ไข
                      </button>
                      <button
                        className="danger-text"
                        onClick={async () => {
                          if (window.confirm("ลบหน้าที่รายการนี้หรือไม่?")) {
                            await deleteDailyAssignment(item.id);
                            await reloadDaily();
                          }
                        }}
                      >
                        ลบ
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
            {!assignments.length && (
              <div className="staff-empty">
                <CalendarDays size={32} />
                <p>ยังไม่ได้จัดหน้าที่สำหรับวันนี้</p>
              </div>
            )}
          </div>
        </>
      )}

      <section className="daily-report" aria-label="รายงานประจำวันห้องแพ็ค">
        <header>
          <div>
            <p>HILLKOFF · ฝ่ายแพ็คสินค้า</p>
            <h1>รายงานสรุปการทำงานประจำวัน</h1>
          </div>
          <strong>{thaiDate(date)}</strong>
        </header>
        <div className="daily-report-summary">
          <span>ทั้งหมด <strong>{workforceSummary.total}</strong></span>
          <span>ปฏิบัติงาน <strong>{workforceSummary.working}</strong></span>
          <span>ลา <strong>{workforceSummary.leave}</strong></span>
          <span>หยุด <strong>{workforceSummary.off}</strong></span>
          <span>ออกนอกพื้นที่ <strong>{workforceSummary.outside}</strong></span>
          <span>ยังไม่มีหน้าที่ <strong>{workforceSummary.unassigned}</strong></span>
        </div>
        <p className="daily-report-lead">
          <strong>หัวหน้า:</strong>{" "}
          {staff.find((person) => person.position === "leader" && person.active !== false)?.fullName || "ยังไม่กำหนด"}
          {" · "}<strong>ผู้ช่วยหัวหน้า:</strong>{" "}
          {staffById.get(dailyLeadId)?.fullName || "ยังไม่กำหนด"}
        </p>
        <table>
          <thead>
            <tr><th>พนักงาน</th><th>ตำแหน่ง</th><th>สถานะ</th><th>หน้าที่รับผิดชอบ</th></tr>
          </thead>
          <tbody>
            {staff.filter((person) => person.active !== false).map((person) => (
              <tr key={`report-${person.id}`}>
                <td>{person.fullName} ({person.nickname})</td>
                <td>{POSITION_LABELS[person.position]}</td>
                <td>{STATUS_LABELS[resolveDailyStatus(person.id, dailyStatuses)]}</td>
                <td>{(dutyLabelsByStaff.get(person.id) ?? []).join("; ") || "ยังไม่ได้กำหนดหน้าที่"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <section className="daily-report-notice">
          <h2>ประกาศและกฎระเบียบห้องแพ็ค</h2>
          <p>{packingNotice}</p>
        </section>
      </section>

      {editingNotice && (
        <div className="staff-modal-overlay" role="presentation">
          <form
            className="staff-modal compact packing-notice-modal"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await savePackingRoomNotice(noticeDraft, firebaseUser);
                setPackingNotice(resolvePackingNotice(noticeDraft));
                setEditingNotice(false);
                setMessage("บันทึกประกาศห้องแพ็คแล้ว");
              } catch (error) {
                setMessage(
                  error.code === "STAFF_NOTICE_INVALID"
                    ? error.message
                    : "บันทึกประกาศไม่สำเร็จ กรุณาลองใหม่"
                );
              }
            }}
          >
            <header>
              <h3>แก้ไขประกาศห้องแพ็ค</h3>
              <button
                type="button"
                aria-label="ปิด"
                onClick={() => setEditingNotice(false)}
              >
                <X size={18} />
              </button>
            </header>
            <label>
              ข้อความประกาศและกฎระเบียบ
              <textarea
                value={noticeDraft}
                maxLength="5000"
                required
                onChange={(event) => setNoticeDraft(event.target.value)}
              />
            </label>
            <small>{noticeDraft.length.toLocaleString("th-TH")} / 5,000 ตัวอักษร</small>
            <footer>
              <button type="button" onClick={() => setEditingNotice(false)}>
                ยกเลิก
              </button>
              <button className="primary-action">บันทึกประกาศ</button>
            </footer>
          </form>
        </div>
      )}

      {editingMember && (
        <div
          className="staff-modal-overlay"
          onClick={() => setEditingMember(null)}
        >
          <form
            className="staff-modal"
            onSubmit={submitMember}
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h3>
                {editingMember.id ? "แก้ไขข้อมูลพนักงาน" : "เพิ่มพนักงาน"}
              </h3>
              <button
                type="button"
                aria-label="ปิด"
                onClick={() => setEditingMember(null)}
              >
                <X />
              </button>
            </header>
            <div className="staff-form-grid">
              <label>
                รูปประจำตัว
                <input name="photo" type="file" accept="image/*" />
              </label>
              <label>
                รหัสพนักงาน
                <input
                  name="employeeId"
                  maxLength="60"
                  defaultValue={editingMember.employeeId}
                  placeholder="เช่น HK-001"
                />
              </label>
              <label>
                ชื่อจริง–นามสกุล *
                <input name="fullName" defaultValue={editingMember.fullName} />
              </label>
              <label>
                ชื่อเล่น *
                <input name="nickname" defaultValue={editingMember.nickname} />
              </label>
              <label>
                ตำแหน่ง *
                <select name="position" defaultValue={editingMember.position}>
                  {Object.entries(POSITION_LABELS).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                เบอร์โทรศัพท์
                <input name="phone" defaultValue={editingMember.phone} />
              </label>
              <label>
                LINE ID
                <input name="lineId" defaultValue={editingMember.lineId} />
              </label>
              <label>
                อีเมล
                <input
                  name="email"
                  type="email"
                  defaultValue={editingMember.email}
                />
              </label>
              <label>
                ลำดับ
                <input
                  name="sortOrder"
                  type="number"
                  min="0"
                  defaultValue={editingMember.sortOrder}
                />
              </label>
              <label className="full">
                หมายเหตุภายใน
                <textarea
                  name="internalNote"
                  defaultValue={editingMember.internalNote}
                />
              </label>
              <label className="staff-checkbox full">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={editingMember.active !== false}
                />{" "}
                กำลังปฏิบัติงาน
              </label>
            </div>
            {editingMember.photoPath && (
              <button
                type="button"
                className="danger-text"
                onClick={async () => {
                  const previousPath = editingMember.photoPath;
                  const next = {
                    ...editingMember,
                    photoPath: "",
                    photoUrl: "",
                  };
                  await saveStaffMember(next, firebaseUser);
                  setEditingMember(next);
                  await reloadBase();
                  try {
                    await removeStaffPhoto(previousPath);
                    setMessage("ลบรูปประจำตัวแล้ว");
                  } catch {
                    setMessage(
                      "นำรูปออกจากทำเนียบแล้ว แต่ลบไฟล์รูปเดิมไม่สำเร็จ"
                    );
                  }
                }}
              >
                ลบรูปประจำตัว
              </button>
            )}
            <footer>
              <button type="button" onClick={() => setEditingMember(null)}>
                ยกเลิก
              </button>
              <button className="primary-action">บันทึก</button>
            </footer>
          </form>
        </div>
      )}
      {editingAssignment && (
        <div
          className="staff-modal-overlay"
          onClick={() => setEditingAssignment(null)}
        >
          <form
            className="staff-modal compact"
            onSubmit={submitAssignment}
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h3>จัดหน้าที่ประจำวัน</h3>
              <button
                type="button"
                aria-label="ปิด"
                onClick={() => setEditingAssignment(null)}
              >
                <X />
              </button>
            </header>
            <label>
              พนักงาน
              <select
                name="staffId"
                defaultValue={editingAssignment.staffId}
                required
              >
                <option value="">เลือกพนักงาน</option>
                {staff
                  .filter((p) => p.active !== false)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nickname} — {p.fullName}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              ประเภทงาน
              <select
                name="dutyTypeId"
                defaultValue={editingAssignment.dutyTypeId}
                required
              >
                <option value="">เลือกประเภทงาน</option>
                {dutyTypes
                  .filter((d) => d.active !== false)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              หมายเหตุ
              <textarea name="note" defaultValue={editingAssignment.note} />
            </label>
            <footer>
              <button type="button" onClick={() => setEditingAssignment(null)}>
                ยกเลิก
              </button>
              <button className="primary-action">บันทึก</button>
            </footer>
          </form>
        </div>
      )}
    </section>
  );
}
