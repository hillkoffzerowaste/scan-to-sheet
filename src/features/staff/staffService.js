import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import { firebaseStorage, firestoreDb } from "../../services/firebase.js";
import { maskStaffContact } from "./staffDirectory.js";
import { overrideDocId } from "./packingSchedule.js";

const STAFF_LIMIT = 200;
const DUTY_LIMIT = 100;
const ASSIGNMENT_LIMIT = 200;
const DAILY_STATUS_LIMIT = 200;
const WEEKLY_DUTY_LIMIT = 300;
const OVERRIDE_LIMIT = 100;

function requireFirebase() {
  if (!firestoreDb)
    throw Object.assign(new Error("ระบบข้อมูลพนักงานยังไม่พร้อมใช้งาน"), {
      code: "STAFF_FIREBASE_UNAVAILABLE",
    });
}

export async function getStaffAdminStatus(uid) {
  if (!firestoreDb || !uid) return false;
  return (await getDoc(doc(firestoreDb, "adminUsers", uid))).exists();
}

export async function listStaffMembers() {
  requireFirebase();
  const snapshot = await getDocs(
    query(collection(firestoreDb, "staffMembers"), limit(STAFF_LIMIT))
  );
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function getPackingRoomNotice() {
  requireFirebase();
  const snapshot = await getDoc(
    doc(firestoreDb, "staffSettings", "packingRoomNotice")
  );
  return snapshot.exists() ? String(snapshot.data().content ?? "") : "";
}

export async function savePackingRoomNotice(content, user) {
  requireFirebase();
  const normalized = String(content ?? "").trim();
  if (!normalized || normalized.length > 5000) {
    const error = new Error("ประกาศต้องมีความยาว 1–5,000 ตัวอักษร");
    error.code = "STAFF_NOTICE_INVALID";
    throw error;
  }
  await setDoc(doc(firestoreDb, "staffSettings", "packingRoomNotice"), {
    content: normalized,
    updatedAt: serverTimestamp(),
    updatedByUid: user.uid,
  });
}

export function subscribeStaffMembers({ onChange, onError }) {
  requireFirebase();
  return onSnapshot(
    query(collection(firestoreDb, "staffMembers"), limit(STAFF_LIMIT)),
    (snapshot) =>
      onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
    onError
  );
}

export function createStaffMemberId() {
  requireFirebase();
  return doc(collection(firestoreDb, "staffMembers")).id;
}

export async function saveStaffMember(member, user) {
  requireFirebase();
  const target = member.id
    ? doc(firestoreDb, "staffMembers", member.id)
    : doc(collection(firestoreDb, "staffMembers"));
  const payload = {
    employeeId: String(member.employeeId ?? "").trim(),
    fullName: String(member.fullName).trim(),
    nickname: String(member.nickname).trim(),
    position: member.position,
    phone: maskStaffContact(member.phone, "phone"),
    lineId: maskStaffContact(member.lineId, "line"),
    email: maskStaffContact(member.email, "email"),
    active: member.active !== false,
    sortOrder: Number(member.sortOrder ?? 0),
    photoUrl: String(member.photoUrl ?? ""),
    photoPath: String(member.photoPath ?? ""),
    updatedAt: serverTimestamp(),
    updatedBy: {
      uid: user.uid,
      email: user.email ?? "",
      name: user.displayName ?? user.name ?? "",
    },
  };
  if (payload.employeeId.length > 60) {
    const error = new Error("รหัสพนักงานยาวเกิน 60 ตัวอักษร");
    error.code = "STAFF_EMPLOYEE_ID_TOO_LONG";
    throw error;
  }
  const codeKey = encodeURIComponent(
    payload.employeeId.toLocaleLowerCase("th")
  );
  const previousCodeKey = encodeURIComponent(
    String(member.previousEmployeeId ?? payload.employeeId)
      .trim()
      .toLocaleLowerCase("th")
  );
  await runTransaction(firestoreDb, async (transaction) => {
    const codeRef = codeKey
      ? doc(firestoreDb, "staffEmployeeCodes", codeKey)
      : null;
    const previousCodeRef =
      previousCodeKey && previousCodeKey !== codeKey
        ? doc(firestoreDb, "staffEmployeeCodes", previousCodeKey)
        : null;
    const codeSnapshot = codeRef ? await transaction.get(codeRef) : null;
    const previousCodeSnapshot = previousCodeRef
      ? await transaction.get(previousCodeRef)
      : null;
    if (codeSnapshot?.exists() && codeSnapshot.data().staffId !== target.id) {
      const error = new Error("รหัสพนักงานนี้ถูกใช้งานแล้ว");
      error.code = "STAFF_DUPLICATE_EMPLOYEE_ID";
      throw error;
    }
    transaction.set(
      target,
      member.createdAt ? payload : { ...payload, createdAt: serverTimestamp() },
      { merge: true }
    );
    transaction.set(
      doc(firestoreDb, "staffPrivateNotes", target.id),
      {
        note: String(member.internalNote ?? "").trim(),
        updatedAt: serverTimestamp(),
        updatedByUid: user.uid,
      },
      { merge: true }
    );
    transaction.set(
      doc(firestoreDb, "staffPrivateContacts", target.id),
      {
        phone: String(member.phone ?? "").trim(),
        lineId: String(member.lineId ?? "").trim(),
        email: String(member.email ?? "").trim(),
        updatedAt: serverTimestamp(),
        updatedByUid: user.uid,
      },
      { merge: true }
    );
    if (codeRef) {
      transaction.set(codeRef, {
        staffId: target.id,
        employeeId: payload.employeeId,
        updatedAt: serverTimestamp(),
      });
    }
    if (
      previousCodeRef &&
      previousCodeSnapshot?.exists() &&
      previousCodeSnapshot.data().staffId === target.id
    ) {
      transaction.delete(previousCodeRef);
    }
  });
  return target.id;
}

export async function listStaffPrivateNotes() {
  requireFirebase();
  const snapshot = await getDocs(
    query(collection(firestoreDb, "staffPrivateNotes"), limit(STAFF_LIMIT))
  );
  return new Map(
    snapshot.docs.map((item) => [item.id, String(item.data().note ?? "")])
  );
}

export async function listStaffPrivateContacts() {
  requireFirebase();
  const snapshot = await getDocs(
    query(collection(firestoreDb, "staffPrivateContacts"), limit(STAFF_LIMIT))
  );
  return new Map(
    snapshot.docs.map((item) => [item.id, item.data()])
  );
}

export async function saveStaffOrder(items, user) {
  requireFirebase();
  if (items.length > STAFF_LIMIT) throw new Error("รายการพนักงานมากเกินกำหนด");
  const batch = writeBatch(firestoreDb);
  items.forEach((item, sortOrder) => {
    batch.set(
      doc(firestoreDb, "staffMembers", item.id),
      {
        sortOrder,
        updatedAt: serverTimestamp(),
        updatedBy: {
          uid: user.uid,
          email: user.email ?? "",
          name: user.displayName ?? user.name ?? "",
        },
      },
      { merge: true }
    );
  });
  await batch.commit();
}

export async function uploadStaffPhoto(memberId, file) {
  if (!firebaseStorage) throw new Error("ระบบจัดเก็บรูปยังไม่พร้อมใช้งาน");
  if (!file?.type?.startsWith("image/"))
    throw new Error("กรุณาเลือกไฟล์รูปภาพ");
  if (file.size > 5 * 1024 * 1024) throw new Error("รูปต้องมีขนาดไม่เกิน 5 MB");
  const extension =
    file.name
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `staff-photos/${memberId}/${Date.now()}.${extension}`;
  const target = ref(firebaseStorage, path);
  await uploadBytes(target, file, { contentType: file.type });
  const photoUrl = await getDownloadURL(target);
  return { photoUrl, photoPath: path };
}

export async function removeStaffPhoto(photoPath) {
  if (!photoPath) return;
  if (!firebaseStorage) throw new Error("ระบบจัดเก็บรูปยังไม่พร้อมใช้งาน");
  await deleteObject(ref(firebaseStorage, photoPath));
}

export async function listDutyTypes() {
  requireFirebase();
  const snapshot = await getDocs(
    query(collection(firestoreDb, "staffDutyTypes"), limit(DUTY_LIMIT))
  );
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function saveDutyType(item, user) {
  requireFirebase();
  const target = item.id
    ? doc(firestoreDb, "staffDutyTypes", item.id)
    : doc(collection(firestoreDb, "staffDutyTypes"));
  await setDoc(
    target,
    {
      name: String(item.name).trim(),
      active: item.active !== false,
      sortOrder: Number(item.sortOrder ?? 0),
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
    },
    { merge: true }
  );
}

export async function listWeeklyDuties() {
  requireFirebase();
  const snapshot = await getDocs(
    query(collection(firestoreDb, "staffWeeklyDuties"), limit(WEEKLY_DUTY_LIMIT))
  );
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function saveWeeklyDuty(item, user) {
  requireFirebase();
  const target = item.id
    ? doc(firestoreDb, "staffWeeklyDuties", item.id)
    : doc(collection(firestoreDb, "staffWeeklyDuties"));
  await setDoc(
    target,
    {
      weekday: Number(item.weekday),
      staffId: String(item.staffId),
      dutyTypeId: String(item.dutyTypeId),
      note: String(item.note ?? "").trim(),
      updatedAt: serverTimestamp(),
      updatedBy: {
        uid: user.uid,
        email: user.email ?? "",
        name: user.displayName ?? user.name ?? "",
      },
    },
    { merge: true }
  );
  return target.id;
}

export async function deleteWeeklyDuty(id) {
  requireFirebase();
  await deleteDoc(doc(firestoreDb, "staffWeeklyDuties", id));
}

export async function listDutyOverrides(date) {
  requireFirebase();
  if (!date) return [];
  const snapshot = await getDocs(
    query(
      collection(firestoreDb, "staffDutyOverrides"),
      where("date", "==", date),
      limit(OVERRIDE_LIMIT)
    )
  );
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

// One document per (date, weekly duty) so repeating the same swap overwrites instead of
// stacking. staffId === "" means the duty is dropped for that day only.
export async function saveDutyOverride({ date, weeklyDutyId, staffId, note }, user) {
  requireFirebase();
  await setDoc(doc(firestoreDb, "staffDutyOverrides", overrideDocId(date, weeklyDutyId)), {
    date,
    weeklyDutyId,
    staffId: String(staffId ?? ""),
    note: String(note ?? "").trim(),
    updatedAt: serverTimestamp(),
    updatedByUid: user.uid,
  });
}

export async function deleteDutyOverride(date, weeklyDutyId) {
  requireFirebase();
  await deleteDoc(
    doc(firestoreDb, "staffDutyOverrides", overrideDocId(date, weeklyDutyId))
  );
}

export async function listDailyAssignments(date) {
  requireFirebase();
  const snapshot = await getDocs(
    query(
      collection(firestoreDb, "staffDailyAssignments"),
      where("date", "==", date),
      limit(ASSIGNMENT_LIMIT)
    )
  );
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function listDailyStatuses(date) {
  requireFirebase();
  if (!date) return [];
  const snapshot = await getDocs(
    query(
      collection(firestoreDb, "staffDailyStatuses"),
      where("date", "==", date),
      limit(DAILY_STATUS_LIMIT)
    )
  );
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function saveDailyStatus({ date, staffId, status }, user) {
  requireFirebase();
  const target = doc(firestoreDb, "staffDailyStatuses", `${date}__${staffId}`);
  if (status === "working") {
    await deleteDoc(target);
    return;
  }
  await setDoc(target, {
    date,
    staffId,
    status,
    updatedAt: serverTimestamp(),
    updatedByUid: user.uid,
  });
}

export async function getDailyLead(date) {
  requireFirebase();
  if (!date) return null;
  const snapshot = await getDoc(doc(firestoreDb, "staffDailyLeads", date));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function saveDailyLead(date, staffId, user) {
  requireFirebase();
  const target = doc(firestoreDb, "staffDailyLeads", date);
  if (!staffId) {
    await deleteDoc(target);
    return;
  }
  await setDoc(target, {
    date,
    staffId,
    updatedAt: serverTimestamp(),
    updatedByUid: user.uid,
  });
}

export async function saveDailyAssignment(item, user) {
  requireFirebase();
  const target = item.id
    ? doc(firestoreDb, "staffDailyAssignments", item.id)
    : doc(collection(firestoreDb, "staffDailyAssignments"));
  await setDoc(
    target,
    {
      date: item.date,
      staffId: item.staffId,
      dutyTypeId: item.dutyTypeId,
      note: String(item.note ?? "").trim(),
      updatedAt: serverTimestamp(),
      updatedBy: {
        uid: user.uid,
        email: user.email ?? "",
        name: user.displayName ?? user.name ?? "",
      },
    },
    { merge: true }
  );
}

export async function deleteDailyAssignment(id) {
  requireFirebase();
  await deleteDoc(doc(firestoreDb, "staffDailyAssignments", id));
}

export async function copyDailyAssignments({
  date,
  assignments,
  replaceIds = [],
  user,
}) {
  requireFirebase();
  if (assignments.length + replaceIds.length > 450)
    throw new Error("รายการหน้าที่มากเกินไปสำหรับการคัดลอกครั้งเดียว");
  const batch = writeBatch(firestoreDb);
  replaceIds.forEach((id) =>
    batch.delete(doc(firestoreDb, "staffDailyAssignments", id))
  );
  assignments.forEach((item) => {
    const target = doc(collection(firestoreDb, "staffDailyAssignments"));
    batch.set(target, {
      date,
      staffId: item.staffId,
      dutyTypeId: item.dutyTypeId,
      note: String(item.note ?? "").trim(),
      updatedAt: serverTimestamp(),
      updatedBy: {
        uid: user.uid,
        email: user.email ?? "",
        name: user.displayName ?? user.name ?? "",
      },
    });
  });
  await batch.commit();
}
