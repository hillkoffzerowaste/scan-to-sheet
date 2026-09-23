import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { firestoreDb } from "../../services/firebase.js";
import {
  createSopSnapshot,
  canCompleteWorkPlanTask,
  STAFF_SOP_LIMIT,
  validateSopDraft,
  validateWorkPlanTask,
  WORK_PLAN_TASK_LIMIT,
} from "./workPlanning.js";

function requireFirebase() {
  if (!firestoreDb) {
    throw Object.assign(new Error("ระบบแผนงานยังไม่พร้อมใช้งาน"), {
      code: "STAFF_WORK_PLAN_FIREBASE_UNAVAILABLE",
    });
  }
}

function sopVersionId(sopId, version) {
  return `${sopId}_v${Number(version)}`;
}

async function ensureSopCapacity(sop) {
  if (sop.id) return;
  const existing = await getDocs(query(collection(firestoreDb, "staffSops"), limit(STAFF_SOP_LIMIT)));
  if (existing.size >= STAFF_SOP_LIMIT) {
    throw Object.assign(new Error("คลัง SOP เต็มตามขีดจำกัดที่รองรับ"), {
      code: "STAFF_SOP_LIMIT",
    });
  }
}

export const WORK_PLANNING_QUERY_LIMITS = {
  sops: STAFF_SOP_LIMIT,
  tasks: WORK_PLAN_TASK_LIMIT,
};

export async function listStaffSops() {
  requireFirebase();
  const snapshot = await getDocs(
    query(collection(firestoreDb, "staffSops"), limit(STAFF_SOP_LIMIT))
  );
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function listWorkPlanTasks(date) {
  requireFirebase();
  if (!date) return [];
  const snapshot = await getDocs(
    query(
      collection(firestoreDb, "staffWorkPlanTasks"),
      where("date", "==", date),
      limit(WORK_PLAN_TASK_LIMIT)
    )
  );
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function getStaffSopVersion(sopId, version) {
  requireFirebase();
  if (!sopId || !Number.isInteger(Number(version)) || Number(version) < 1) return null;
  const snapshot = await getDoc(
    doc(firestoreDb, "staffSopVersions", sopVersionId(sopId, version))
  );
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function saveStaffSopDraft(sop, user) {
  requireFirebase();
  await ensureSopCapacity(sop);
  const draft = {
    title: String(sop.title ?? "").trim(),
    description: String(sop.description ?? "").trim(),
    steps: sop.steps,
  };
  const errors = validateSopDraft(draft);
  if (errors.length) {
    throw Object.assign(new Error("กรุณาตรวจชื่อ SOP และขั้นตอนให้ครบก่อนบันทึก"), {
      code: "STAFF_SOP_INVALID",
      detail: errors,
    });
  }
  const target = sop.id
    ? doc(firestoreDb, "staffSops", sop.id)
    : doc(collection(firestoreDb, "staffSops"));
  await setDoc(
    target,
    {
      title: draft.title,
      description: draft.description,
      draftSteps: draft.steps,
      active: sop.active !== false,
      latestVersion: Number(sop.latestVersion ?? 0),
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
      ...(!sop.id
        ? { createdAt: serverTimestamp(), createdByUid: user.uid }
        : {}),
    },
    { merge: true }
  );
  return target.id;
}

export async function publishStaffSop(sop, user) {
  requireFirebase();
  await ensureSopCapacity(sop);
  const errors = validateSopDraft(sop);
  if (errors.length) {
    throw Object.assign(new Error("กรุณาตรวจชื่อ SOP และขั้นตอนให้ครบก่อนเผยแพร่"), {
      code: "STAFF_SOP_INVALID",
      detail: errors,
    });
  }
  const target = sop.id
    ? doc(firestoreDb, "staffSops", sop.id)
    : doc(collection(firestoreDb, "staffSops"));
  const version = await runTransaction(firestoreDb, async (transaction) => {
    const current = await transaction.get(target);
    const nextVersion = Number(current.data()?.latestVersion ?? 0) + 1;
    const snapshot = createSopSnapshot({ ...sop, id: target.id }, nextVersion);
    const versionRef = doc(
      firestoreDb,
      "staffSopVersions",
      sopVersionId(target.id, nextVersion)
    );
    transaction.set(versionRef, {
      ...snapshot,
      publishedAt: serverTimestamp(),
      publishedByUid: user.uid,
    });
    transaction.set(
      target,
      {
        title: snapshot.title,
        description: snapshot.description,
        publishedTitle: snapshot.title,
        publishedDescription: snapshot.description,
        draftSteps: snapshot.steps,
        active: true,
        latestVersion: nextVersion,
        updatedAt: serverTimestamp(),
        updatedByUid: user.uid,
        ...(!current.exists()
          ? { createdAt: serverTimestamp(), createdByUid: user.uid }
          : {}),
      },
      { merge: true }
    );
    return nextVersion;
  });
  return { id: target.id, version };
}

export async function setStaffSopActive(sopId, active, user) {
  requireFirebase();
  await setDoc(
    doc(firestoreDb, "staffSops", sopId),
    { active: Boolean(active), updatedAt: serverTimestamp(), updatedByUid: user.uid },
    { merge: true }
  );
}

export async function createWorkPlanTask(task, user) {
  requireFirebase();
  const errors = validateWorkPlanTask(task);
  if (errors.length) {
    throw Object.assign(new Error("กรุณากำหนดวันที่ SOP ผู้รับผิดชอบ และลำดับงานให้ครบ"), {
      code: "STAFF_WORK_PLAN_INVALID",
      detail: errors,
    });
  }
  const target = doc(collection(firestoreDb, "staffWorkPlanTasks"));
  const planRef = doc(firestoreDb, "staffWorkPlans", task.date);
  await runTransaction(firestoreDb, async (transaction) => {
    const planSnapshot = await transaction.get(planRef);
    let taskCount = Number(planSnapshot.data()?.taskCount ?? 0);
    let sequence = Number(planSnapshot.data()?.nextSequence ?? 1);
    let sameDayDocs = [];
    if (!planSnapshot.exists()) {
      const existing = await transaction.get(query(
        collection(firestoreDb, "staffWorkPlanTasks"),
        where("date", "==", task.date),
        limit(WORK_PLAN_TASK_LIMIT)
      ));
      sameDayDocs = existing.docs;
      if (existing.size >= WORK_PLAN_TASK_LIMIT) {
        throw Object.assign(new Error("แผนงานวันนี้เต็มตามขีดจำกัดที่รองรับ"), {
          code: "STAFF_WORK_PLAN_TASK_LIMIT",
        });
      }
      taskCount = existing.size;
      sequence = sameDayDocs.reduce(
        (max, item) => Math.max(max, Number(item.data().sequence) || 0),
        0
      ) + 1;
    }
    if (taskCount >= WORK_PLAN_TASK_LIMIT) {
      throw Object.assign(new Error("แผนงานวันนี้เต็มตามขีดจำกัดที่รองรับ"), {
        code: "STAFF_WORK_PLAN_TASK_LIMIT",
      });
    }
    const dependencySnapshots = planSnapshot.exists()
      ? await Promise.all(task.dependsOnTaskIds.map((id) => transaction.get(
          doc(firestoreDb, "staffWorkPlanTasks", id)
        )))
      : task.dependsOnTaskIds.map((id) => sameDayDocs.find((item) => item.id === id) ?? null);
    if (dependencySnapshots.some((snapshot) => {
      const data = snapshot?.data?.();
      return !data || data.date !== task.date;
    })) {
      throw Object.assign(new Error("งานที่เลือกเป็นเงื่อนไขไม่มีอยู่ในแผนวันนี้"), {
        code: "STAFF_WORK_PLAN_DEPENDENCY_INVALID",
      });
    }
    transaction.set(target, {
      date: task.date,
      sequence,
      targetTime: String(task.targetTime ?? ""),
      assignedStaffIds: task.assignedStaffIds.map(String),
      dependsOnTaskIds: task.dependsOnTaskIds.map(String),
      sopId: String(task.sopId),
      sopVersion: Number(task.sopVersion),
      sopSnapshot: task.sopSnapshot,
      stepProgress: Object.fromEntries(task.sopSnapshot.steps.map((step) => [step.id, false])),
      status: "planned",
      note: String(task.note ?? "").trim().slice(0, 500),
      createdAt: serverTimestamp(),
      createdByUid: user.uid,
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
    });
    transaction.set(planRef, {
      date: task.date,
      taskCount: taskCount + 1,
      nextSequence: sequence + 1,
      ...(!planSnapshot.exists()
        ? { createdAt: serverTimestamp(), createdByUid: user.uid }
        : {}),
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
    }, { merge: true });
  });
  return target.id;
}

export async function updateWorkPlanTask(task, changes, user) {
  requireFirebase();
  const allowed = {};
  if (Object.hasOwn(changes, "status")) {
    if (!Object.hasOwn({ planned: true, in_progress: true, blocked: true, completed: true }, changes.status)) {
      throw Object.assign(new Error("สถานะงานไม่ถูกต้อง"), { code: "STAFF_WORK_PLAN_STATUS_INVALID" });
    }
    allowed.status = changes.status;
  }
  if (Object.hasOwn(changes, "stepProgress")) {
    allowed.stepProgress = changes.stepProgress;
  }
  if (!Object.keys(allowed).length) return;
  const nextTask = { ...task, ...allowed };
  if (allowed.status === "in_progress" || allowed.status === "completed") {
    const dependencySnapshots = await Promise.all((task.dependsOnTaskIds ?? []).map((id) =>
      getDoc(doc(firestoreDb, "staffWorkPlanTasks", id))
    ));
    if (dependencySnapshots.some((snapshot) => (
      !snapshot.exists() ||
      snapshot.data().date !== task.date ||
      snapshot.data().status !== "completed"
    ))) {
      throw Object.assign(new Error("งานก่อนหน้ายังไม่เสร็จ"), {
        code: "STAFF_WORK_PLAN_PREREQUISITE_INCOMPLETE",
      });
    }
  }
  if (allowed.status === "completed" && !canCompleteWorkPlanTask(nextTask)) {
    throw Object.assign(new Error("ยังทำขั้นตอนบังคับของ SOP ไม่ครบ"), {
      code: "STAFF_WORK_PLAN_STEPS_INCOMPLETE",
    });
  }
  const batch = writeBatch(firestoreDb);
  const taskRef = doc(firestoreDb, "staffWorkPlanTasks", task.id);
  batch.set(taskRef, {
    ...allowed,
    updatedAt: serverTimestamp(),
    updatedByUid: user.uid,
  }, { merge: true });
  const eventRef = doc(collection(firestoreDb, "staffWorkPlanEvents"));
  const event = {
    date: task.date,
    taskId: task.id,
    type: Object.hasOwn(changes, "stepProgress") ? "step_progress" : "status_change",
    status: allowed.status ?? task.status,
    actorUid: user.uid,
    createdAt: serverTimestamp(),
  };
  if (Object.hasOwn(changes, "stepProgress")) {
    const stepId = Object.keys(allowed.stepProgress).find(
      (id) => allowed.stepProgress[id] !== task.stepProgress?.[id]
    );
    if (!stepId) {
      throw Object.assign(new Error("ไม่มีการเปลี่ยนแปลงขั้นตอน"), {
        code: "STAFF_WORK_PLAN_STEP_UNCHANGED",
      });
    }
    event.stepId = stepId;
    event.completed = Boolean(allowed.stepProgress[stepId]);
  }
  batch.set(eventRef, event);
  await batch.commit();
}

export async function deleteWorkPlanTask(task, remainingTasks, user) {
  requireFirebase();
  if (remainingTasks.some((item) => (item.dependsOnTaskIds ?? []).includes(task.id))) {
    throw Object.assign(new Error("งานนี้ยังเป็นเงื่อนไขก่อนเริ่มของงานอื่น"), {
      code: "STAFF_WORK_PLAN_HAS_DEPENDENTS",
    });
  }
  if (remainingTasks.length > WORK_PLAN_TASK_LIMIT) {
    throw Object.assign(new Error("รายการแผนงานมากเกินกว่าจะจัดลำดับอย่างปลอดภัย"), {
      code: "STAFF_WORK_PLAN_ORDER_LIMIT",
    });
  }
  const planRef = doc(firestoreDb, "staffWorkPlans", task.date);
  const eventRef = doc(collection(firestoreDb, "staffWorkPlanEvents"));
  await runTransaction(firestoreDb, async (transaction) => {
    const planSnapshot = await transaction.get(planRef);
    transaction.delete(doc(firestoreDb, "staffWorkPlanTasks", task.id));
    remainingTasks.forEach((item, index) => {
      transaction.set(doc(firestoreDb, "staffWorkPlanTasks", item.id), {
        sequence: index + 1,
        updatedAt: serverTimestamp(),
        updatedByUid: user.uid,
      }, { merge: true });
    });
    transaction.set(planRef, {
      date: task.date,
      taskCount: remainingTasks.length,
      nextSequence: remainingTasks.length + 1,
      ...(!planSnapshot.exists()
        ? { createdAt: serverTimestamp(), createdByUid: user.uid }
        : {}),
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
    }, { merge: true });
    transaction.set(eventRef, {
      date: task.date,
      taskId: task.id,
      type: "task_deleted",
      status: task.status,
      actorUid: user.uid,
      createdAt: serverTimestamp(),
    });
  });
}

export async function saveWorkPlanOrder(tasks, user) {
  requireFirebase();
  if (tasks.length > WORK_PLAN_TASK_LIMIT) {
    throw Object.assign(new Error("รายการแผนงานมากเกินกว่าจะจัดลำดับอย่างปลอดภัย"), {
      code: "STAFF_WORK_PLAN_ORDER_LIMIT",
    });
  }
  const batch = writeBatch(firestoreDb);
  tasks.forEach((task, index) => {
    batch.set(
      doc(firestoreDb, "staffWorkPlanTasks", task.id),
      { sequence: index + 1, updatedAt: serverTimestamp(), updatedByUid: user.uid },
      { merge: true }
    );
  });
  await batch.commit();
}
