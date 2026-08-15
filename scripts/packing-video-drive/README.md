# Packing video → Google Drive worker

ย้ายวิดีโอแพ็คพัสดุที่อัปโหลดขึ้น Firebase Storage แล้ว เข้าไปเก็บถาวรใน Google Drive (Shared Drive)

## ทำไมต้องเป็น worker แยก ไม่ใช่ Vercel cron

แต่ละรอบต้องสตรีมไฟล์หลายสิบเมกะไบต์ต่อคลิป ซึ่งเกินทั้งลิมิตเวลาและหน่วยความจำของ serverless
worker ตัวนี้จึงออกแบบให้รันบนเครื่อง office ผ่าน Task Scheduler แบบเดียวกับ `scripts/marketplace-sync/`

## ทำไมต้องใช้ Service Account + Shared Drive

scope `drive.file` ของผู้ใช้ที่ล็อกอินในเว็บ **ใช้ที่นี่ไม่ได้** เพราะมันเห็นเฉพาะไฟล์ที่แอปสร้างผ่าน UI ของคนคนนั้น

ส่วนการเอา refresh token ของพนักงานมาใช้ ทำได้ทางเทคนิคแต่ไม่ควร — ไฟล์จะกลายเป็นของคนคนนั้น
พอลาออกหรือเปลี่ยนรหัสผ่าน หลักฐานทั้งคลังจะมีปัญหาเจ้าของทันที

Shared Drive ทำให้ไฟล์เป็นของ**องค์กร** ไม่ผูกกับบุคคล และ service account ไม่มี OAuth ให้หมดอายุ

> ต้องมี Google Workspace จึงจะสร้าง Shared Drive ได้ ถ้าเป็น Gmail ธรรมดาจะใช้วิธีนี้ไม่ได้

## ตั้งค่าครั้งแรก

1. สร้าง Shared Drive ชื่อ `Packing Videos`
2. สร้าง service account ใน Google Cloud project เดียวกัน แล้วดาวน์โหลด key เป็น JSON
3. เพิ่มอีเมลของ service account เข้า Shared Drive ในสิทธิ์ **Content manager**
4. เปิด Google Drive API ใน project นั้น
5. คัดลอก `config.example.json` เป็น `config.json` แล้วใส่ `sharedDriveId`
   (หาได้จาก URL ของ Shared Drive: `drive.google.com/drive/folders/<ID>`)

## รัน

```bash
npm run packing:drive:once
```

## worker ทำอะไรบ้าง

รอบละไม่เกิน 25 คลิป (ถ้าเต็มโควตาจะ log บอกว่ายังมีค้าง — ไม่เงียบ):

1. หา `driveStatus == 'pending'` และ `status == 'uploaded'` เรียงตาม `uploadedAt`
2. สร้าง/หาโฟลเดอร์ `Packing Videos / ปี / วันที่ / แพลตฟอร์ม` (cache ต่อรอบ)
3. สตรีมจาก Storage เข้า Drive แบบ resumable
4. อัปเดต `driveFileId`, `driveUrl`, `movedToDriveAt` และเขียน audit `drive_moved`
5. รอบสอง: ลบไฟล์ใน Storage ที่ย้ายไปเกิน **7 วัน** แล้วเท่านั้น

## ข้อควรระวัง

- **ต้องใช้ `update()` ห้าม `set()`** — worker ใช้ firebase-admin ซึ่งข้าม security rules
  ถ้าเขียนทับจน field หาย ฝั่ง client จะเขียนไม่ผ่าน `hasOnly()` และ batch จะล้มทั้งชุด
  รายชื่อ field อยู่ที่ `src/services/packingVideoModel.js` ที่เดียว ทั้ง worker และ rules อ้างอิงตัวนี้
- **ไม่ลบไฟล์ใน Storage ทันทีที่ย้ายเสร็จ** เว้นระยะ 7 วันไว้ตรวจว่าไฟล์ใน Drive เปิดเล่นได้จริง
  และให้การเปิดดูของสัปดาห์ปัจจุบันยังเร็ว
- **ต้องตั้ง lifecycle rule บน bucket ที่ prefix `packing-videos/` อายุ 14 วันด้วย**
  เป็นเพดานแข็งกันกรณี worker ตายแล้วไม่มีใครรู้ ค่า storage จะได้ไม่บานปลาย
- นามสกุลไฟล์ต้องเป็น container จริง เปลี่ยน `.webm` เป็น `.mp4` เฉยๆ ไม่ได้ ไฟล์จะเปิดไม่ขึ้น
- ชื่อไฟล์ใช้ `employeeId` ไม่ใช่ชื่อเล่นไทย เพราะชื่อไทยจะถูก sanitize จนเหลือค่าว่าง
