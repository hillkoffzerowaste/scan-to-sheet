export const STAFF_WORKSPACE_MODULE = {
  id: "staff-workspace",
  title: "บริหารทีมงานห้องแพ็ค",
  modules: [
    { id: "directory", label: "โครงสร้างทีม", description: "รายชื่อ ตำแหน่ง และสถานะทีม" },
    { id: "schedule", label: "ตารางเวร", description: "แม่แบบงานประจำและการปรับเฉพาะวัน" },
    { id: "workplan", label: "แผนงานรายวัน", description: "จัดลำดับงานและติดตามผลตามกะ" },
    { id: "sops", label: "คลัง SOP", description: "จัดทำและควบคุมมาตรฐานงาน" },
  ],
};

export function findStaffModule(moduleId) {
  return STAFF_WORKSPACE_MODULE.modules.find((item) => item.id === moduleId) ?? null;
}
