# Compact Scan Popup Design

## เป้าหมาย

ปรับหน้าต่างสแกนให้มีขนาดพอดี ใช้งานสะดวกทั้งคอมพิวเตอร์ที่ต่อเครื่องยิงบาร์โค้ดและมือถือที่ใช้กล้อง โดยไม่ขยายเต็มจอ และแสดงผลสำเร็จ เลขซ้ำ คำเตือน และข้อผิดพลาดภายใน popup ด้วย

## ขอบเขต

- ปรับเฉพาะ layout, accessibility และการแสดงสถานะของ scan popup
- ใช้กับทั้ง Packer และ Drive
- รักษาคิวสแกนต่อเนื่อง การเขียน Firestore/Google Sheet และกฎ duplicate เดิม
- ไม่เปลี่ยน schema, security rules, API หรือข้อความสถานะของหน้าเว็บหลัก

## Responsive layout

### คอมพิวเตอร์และแท็บเล็ตแนวนอน

- แสดง modal card กลาง viewport
- ความกว้าง `min(720px, calc(100vw - 40px))`
- ความสูงตามเนื้อหาและไม่เกิน `min(80vh, 760px)`
- พื้น popup ทึบ ขอบ 1px มุมโค้งตาม token เดิม และใช้เงา modal เพียงชั้นเดียว
- overlay รองรับ blur 3px ตามระบบดีไซน์เดิม

### มือถือและแท็บเล็ตแนวตั้ง

- แสดง compact bottom sheet ที่เว้นขอบซ้าย ขวา และล่าง 12px
- กว้าง `calc(100vw - 24px)` และสูงไม่เกิน `82dvh`
- มุมโค้งทุกด้าน ไม่ชิดขอบจอและไม่กลายเป็นหน้าเต็มจอ
- ส่วนเนื้อหาที่ยาวเลื่อนภายใน popup โดยไม่ทำให้หน้าเว็บด้านหลังเลื่อน

## โครงสร้างภายใน

1. Header แถวเดียว แสดง workflow, ขนส่งที่เลือก และปุ่มปิด `×`
2. แถบ feedback จากสถานะล่าสุด
3. Packer controls เมื่ออยู่ workflow Packer
4. ตัวเลือกวิธีสแกน “เครื่องยิง” และ “กล้อง”
5. พื้นที่สแกนหลัก
   - เครื่องยิง: ช่องเลขขนาดใหญ่ ปุ่มส่ง และสถานะคิว
   - กล้อง: viewport อัตราส่วนประมาณ 4:3 พร้อมปุ่มเปิดหรือหยุดกล้อง
6. ปุ่มปิดแบบข้อความด้านล่างเป็นทางเลือกสำรองสำหรับ touch target

## การแสดงสถานะใน popup

- ใช้ state `status` ชุดเดียวกับ `StatusBanner` บนหน้าหลัก เพื่อไม่ให้ข้อความสองตำแหน่งขัดกัน
- แสดงเฉพาะสถานะล่าสุดและเปลี่ยนทันทีเมื่อมีผลใหม่
- map รูปแบบตาม `status.type` เดิม:
  - `success`: บันทึกสำเร็จ
  - `duplicate`: เลขซ้ำหรือกำลังซิงก์รายการเดิม
  - `warning`: รอ Sheet, คิวเต็ม หรือคำเตือนที่แก้ไขได้
  - `error`: validation หรือการบันทึกล้มเหลว
  - `ignored`: ไม่ใช่บาร์โค้ดหลัก
- แถบ feedback ใช้ `role="status"`, `aria-live="polite"` และ `aria-atomic="true"`
- popup ไม่ปิดอัตโนมัติเมื่อสำเร็จ ซ้ำ หรือผิดพลาด เพื่อรองรับการยิงต่อเนื่อง
- `scanQueueStatusText` ยังคงแสดงแยกใต้ช่องเครื่องยิงสำหรับสถานะ “กำลังบันทึก/รอคิว”

## การเปิด ปิด และ focus

- เมื่อเปิด popup ในโหมดเครื่องยิง ให้ focus ช่องรับเลขทันที
- หลังสแกนแต่ละครั้งคืน focus ผ่านกลไกเดิม
- ปิดได้จากปุ่ม `×`, ปุ่มปิดด้านล่าง, ปุ่ม Escape และการกด overlay
- เมื่อปิด ให้หยุดกล้อง แต่คิวสแกนที่รับแล้วทำงานต่อเบื้องหลัง
- ขณะ popup เปิด ให้ล็อกการเลื่อนของ `body` และคืนค่าเดิมเมื่อปิด
- modal ใช้ `role="dialog"`, `aria-modal="true"` และ label ที่อธิบาย workflow ปัจจุบัน
- ปุ่มปิดต้องเป็น element แรกที่เข้าถึงได้ด้วย keyboard ภายใน dialog; ไม่เพิ่ม focus trap ในรอบนี้เพื่อหลีกเลี่ยง dependency และความซับซ้อนที่ไม่จำเป็น

## CSS และ accessibility

- สีใหม่ทั้งหมดใช้ CSS variable ที่มีอยู่ ห้ามเพิ่ม hardcoded hex/rgba ในกฎใหม่
- ใช้ breakpoint เดิมของโปรเจกต์และตรวจที่ 375, 768, 1000, 1280 และ 1400px
- horizontal overflow ต้องเท่ากับ 0px ทุกขนาด
- popup card ทึบ ห้ามใช้ backdrop blur ที่ตัว card
- focus-visible ของปุ่มปิดและ controls ต้องมองเห็นได้
- ขนาด touch target ของปุ่มปิดและ action หลักไม่น้อยกว่า 44px

## การจัดการข้อผิดพลาด

- feedback ใน popup เป็นการ render state เดิม ไม่เพิ่ม error state ใหม่
- ถ้า popup ปิดอยู่ ผลล่าสุดยังแสดงผ่าน `StatusBanner` เดิม
- ถ้ารายการหนึ่งล้มเหลว คิวรายการถัดไปยังทำงานตามระบบ FIFO เดิม
- หาก dev environment ไม่มี OAuth/Firebase ให้ถือ 401 ของ config เป็นข้อจำกัด environment ไม่ใช่ popup failure แต่ต้องไม่มี Vite overlay หรือ JavaScript runtime error

## การตรวจสอบ

- เพิ่ม component-level test หรือ static assertion ที่เหมาะกับโครงสร้างเทสต์ปัจจุบันสำหรับ dialog semantics และ popup feedback
- รัน `npm run test:marketplace`
- รัน `npm run build`
- ตรวจ browser ทั้ง light/dark ที่ 375, 768, 1000, 1280 และ 1400px
- ตรวจ modal ไม่เต็มจอ, overflow 0px, status แสดงใน popup, Escape/overlay/ปุ่มปิดทำงาน และช่องเครื่องยิงได้รับ focus เมื่อเงื่อนไข login พร้อม

## สิ่งที่ไม่ทำ

- ไม่เปลี่ยนหน้า scan หลักนอก popup
- ไม่เพิ่ม draggable sheet, resize handle หรือ animation ตกแต่ง
- ไม่ย้ายคิวสแกนไป persistent storage
- ไม่เปลี่ยนวิธีตรวจเลขซ้ำหรือการเขียนข้อมูล
