import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Copy,
  Mail,
  Pencil,
  Phone,
  Plus,
  Search,
  UserRound,
  Users,
  X,
} from "lucide-react";
import {
  buildPackerOptions,
  groupActiveStaff,
  mergeAssignments,
  staffSaveErrorMessage,
  validateStaffInput,
} from "./staffDirectory.js";
import {
  copyDailyAssignments,
  createStaffMemberId,
  deleteDailyAssignment,
  getStaffAdminStatus,
  listDailyAssignments,
  listDutyTypes,
  listStaffMembers,
  listStaffPrivateNotes,
  removeStaffPhoto,
  saveDailyAssignment,
  saveDutyType,
  saveStaffMember,
  uploadStaffPhoto,
} from "./staffService.js";

const POSITION_LABELS = {
  leader: "หัวหน้า",
  checker: "Checker",
  packer: "Packer",
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

export default function StaffDirectory({
  firebaseUser,
  onPackerOptionsChange,
}) {
  const [staff, setStaff] = useState([]);
  const [dutyTypes, setDutyTypes] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [section, setSection] = useState("directory");
  const [date, setDate] = useState(() =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(
      new Date()
    )
  );
  const [queryText, setQueryText] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [editingAssignment, setEditingAssignment] = useState(null);
  const [dutyName, setDutyName] = useState("");
  const [message, setMessage] = useState("");
  const [copying, setCopying] = useState(false);

  async function reloadBase(includePrivate = isAdmin) {
    const [publicMembers, duties, privateNotes] = await Promise.all([
      listStaffMembers(),
      listDutyTypes(),
      includePrivate ? listStaffPrivateNotes() : Promise.resolve(new Map()),
    ]);
    const members = publicMembers.map((person) => ({
      ...person,
      internalNote: privateNotes.get(person.id),
    }));
    setStaff(members);
    setDutyTypes(duties);
    try {
      onPackerOptionsChange?.(buildPackerOptions(members), members.length);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function reloadAssignments(selectedDate = date) {
    setAssignments(await listDailyAssignments(selectedDate));
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
    if (firebaseUser && section === "schedule") void reloadAssignments();
  }, [date, section, firebaseUser?.uid]);

  const visibleStaff = useMemo(
    () =>
      staff.filter((person) => {
        if (!showInactive && person.active === false) return false;
        const needle = queryText.trim().toLocaleLowerCase("th");
        return (
          !needle ||
          [
            person.fullName,
            person.employeeId,
            person.nickname,
            person.phone,
            person.lineId,
            person.email,
            POSITION_LABELS[person.position],
          ].some((value) =>
            String(value ?? "")
              .toLocaleLowerCase("th")
              .includes(needle)
          )
        );
      }),
    [staff, queryText, showInactive]
  );
  const groups = groupActiveStaff(
    showInactive
      ? visibleStaff.map((person) => ({ ...person, active: true }))
      : visibleStaff
  );
  const staffById = useMemo(
    () => new Map(staff.map((person) => [person.id, person])),
    [staff]
  );
  const dutyById = useMemo(
    () => new Map(dutyTypes.map((item) => [item.id, item])),
    [dutyTypes]
  );

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
      await reloadAssignments();
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
      await reloadAssignments();
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
          <h2 id="staff-title">ทำเนียบพนักงานแพ็คสินค้า</h2>
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
          <Users size={17} /> ทำเนียบพนักงาน
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
          <div className="staff-toolbar">
            <label className="staff-search">
              <Search size={17} />
              <input
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder="ค้นหาชื่อ ชื่อเล่น ตำแหน่ง หรือข้อมูลติดต่อ"
              />
            </label>
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
          {Object.entries(POSITION_LABELS).map(
            ([position, label]) =>
              groups[position].length > 0 && (
                <section className="staff-group" key={position}>
                  <h3>
                    {label} <span>{groups[position].length} คน</span>
                  </h3>
                  <div className="staff-grid">
                    {groups[position].map((person) => (
                      <article
                        className={`staff-card ${
                          person.active === false ? "inactive" : ""
                        }`}
                        key={person.id}
                      >
                        <div className="staff-photo">
                          {person.photoUrl ? (
                            <img
                              src={person.photoUrl}
                              alt={`รูปของ ${person.fullName}`}
                            />
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
                          <div className="staff-contact">
                            {person.phone && (
                              <a href={`tel:${person.phone}`}>
                                <Phone size={15} />
                                {person.phone}
                              </a>
                            )}
                            {person.lineId && (
                              <button
                                onClick={() =>
                                  navigator.clipboard?.writeText(person.lineId)
                                }
                              >
                                LINE: {person.lineId}
                              </button>
                            )}
                            {person.email && (
                              <a href={`mailto:${person.email}`}>
                                <Mail size={15} />
                                {person.email}
                              </a>
                            )}
                          </div>
                          {isAdmin && (
                            <button
                              className="staff-edit"
                              onClick={() => setEditingMember(person)}
                            >
                              <Pencil size={15} /> แก้ไข
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )
          )}
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
                onChange={(e) => setDate(e.target.value)}
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
                            await reloadAssignments();
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
