export const STAFF_WORKSPACE_MODULE = {
  id: "staff-workspace",
  title: "บริหารทีมงานห้องแพ็ค",
  modules: [
    { id: "directory", label: "โครงสร้างทีม", description: "รายชื่อ ตำแหน่ง และสถานะทีม" },
    { id: "schedule", label: "ตารางเวร", description: "แม่แบบงานประจำและการปรับเฉพาะวัน" },
    {
      id: "planning",
      label: "แผนงานและ SOP",
      description: "แผนปฏิบัติงานและขั้นตอนมาตรฐาน",
      children: [
        { id: "plan", label: "แผนงานวันนี้", description: "จัดลำดับงานและติดตามความคืบหน้า" },
        { id: "sops", label: "คลัง SOP", description: "จัดทำและเผยแพร่ขั้นตอนมาตรฐาน" },
      ],
    },
  ],
};

export function findStaffModule(moduleId) {
  return STAFF_WORKSPACE_MODULE.modules.find((item) => item.id === moduleId)
    ?? STAFF_WORKSPACE_MODULE.modules.flatMap((item) => item.children ?? []).find((item) => item.id === moduleId)
    ?? null;
}
