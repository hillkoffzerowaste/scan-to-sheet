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

const STAFF_LIMIT = 200;
const DUTY_LIMIT = 100;
const ASSIGNMENT_LIMIT = 200;

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
    fullName: String(member.fullName).trim(),
    nickname: String(member.nickname).trim(),
    position: member.position,
    phone: String(member.phone ?? "").trim(),
    lineId: String(member.lineId ?? "").trim(),
    email: String(member.email ?? "").trim(),
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
  const batch = writeBatch(firestoreDb);
  batch.set(
    target,
    member.createdAt ? payload : { ...payload, createdAt: serverTimestamp() },
    { merge: true }
  );
  batch.set(
    doc(firestoreDb, "staffPrivateNotes", target.id),
    {
      note: String(member.internalNote ?? "").trim(),
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
    },
    { merge: true }
  );
  await batch.commit();
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
