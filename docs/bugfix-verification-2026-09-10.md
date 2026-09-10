# บันทึกตรวจแก้บั๊ก 2026-09-10

## ขอบเขตที่แก้

- คิวสแกนรับงานต่อได้หลัง `process` throw แบบ synchronous
- คิว fallback ไม่ข้ามรายการติดกัน ไม่ตัดรายการเก่าทิ้งเมื่อครบ 50 และไม่ยืมขนส่ง/บทบาท/ผู้สแกนจากงานใหม่
- fallback เก็บ context เฉพาะข้อมูลผู้สแกน ไม่เก็บ token; รายการเก่าที่ระบุบทบาทไม่ได้จะคงอยู่และแจ้งให้ตรวจสอบ
- manual recovery อ่านช่วงวันที่เลือก รวมสถานะ writing ค้างและ legacy แล้วประมวลผล snapshot ทีละ 20 จนจบ ไม่ต้องกดซ้ำทุก 20 รายการ; automatic recovery ยังคง batch เล็ก
- ตรวจผลตาม order ID และทุกบทบาทที่ Firestore บันทึก; นับสำเร็จเมื่ออ่าน Sheet ยืนยันแล้วและ Firestore รับ acknowledgement จริง
- อ่านวันที่ Admin ตามวันที่ที่เลือก ไม่ใช้เฉพาะหน้าต่าง 48 ชั่วโมงล่าสุด; query ที่ล้มเหลวไม่ถูกแทนด้วยรายการว่าง
- ซ่อมข้อมูล Admin ที่ขาดและ native date/time โดยรักษาชื่อผู้ซื้อใน P และไม่ลดสถานะของแถวที่แพ็คแล้ว
- อ่านยืนยัน duplicate/แถวข้ามวันใหม่จากแท็บจริง; แยก grid-read ไม่เกิน 50 ranges ต่อ request
- batch append ใช้ server-side AppendCells เพื่อไม่เขียนทับแถวท้ายที่คอลัมน์ A ว่างหรือแถวที่อีกเครื่องเพิ่งเพิ่ม
- รายงานอ่าน scan-event dates เพิ่มจาก order.date เพื่อไม่ตกหล่นการสแกนข้ามวัน; เวลา elapsed ใช้ Asia/Bangkok แม้ timezone เครื่องต่างกัน

## การตรวจสอบ

- `npm run test:marketplace`: 270 tests, ผ่าน 268, skipped 2
- `npm run test:label-sync`: ผ่าน 38
- `node --test src/services/deploymentUpdate.test.js`: ผ่าน 2
- `npm run build`: ผ่าน มีคำเตือน bundle ใหญ่กว่า 500 kB
- `npm run test:e2e -- --reporter=line`: ผ่าน 43 รวม layout 1280/1440/1920 และ light/dark
- เปิดหน้า local และแผง recovery ตรวจ render เพิ่มเติมแล้ว

เทสต์ skipped คือไฟล์ export จริงของ TikTok และ Shopee ที่ไม่มี fixture ในเครื่อง ไม่ใช่การข้าม failure ใหม่

ปรับเทสต์เดิมสองจุด: ถอด regex ที่บังคับ recovery ต้องส่ง 3,000 พร้อมกัน (แทนด้วย behavioral test ที่ drain 45 รายการครบใน 3 batches) และแก้ grid fixture ให้เป็น serial ของวัน/เวลาจริง ไม่ใช่ตัวเลขสมมติที่เป็นเวลาเกินหนึ่งวัน

## ข้อจำกัดที่ต้องตรวจในระบบจริง

- ไม่มี OAuth configuration ใน local จึงยังไม่ได้กด recovery กับ Firestore/Google Sheet production หรือยืนยันว่าข้อมูลวันที่ 9 ถูกกู้คืนแล้ว
- ยังมีขีดจำกัดอ่าน 3,000 documents ต่อ query/วัน และช่วงไม่เกิน 31 วัน; recovery แจ้งเตือนเมื่อแตะขีดจำกัด ส่วนรายงานปฏิเสธการแสดงยอดรวมที่อาจไม่ครบ
- รายการที่ยังมี lease ของเครื่องอื่นถูกข้ามและรายงานให้เห็น; ควรกู้คืนซ้ำหลังงานเดิมเสร็จหรือ lease หมด
- ข้อมูลวันที่/เวลาที่ขัดแย้งกันระหว่างสองระบบไม่ถูกเขียนทับโดยเดา; รายการที่ไม่ตรงกับ Firestore จะยังไม่ผ่านการยืนยัน
- ไม่ได้ทดสอบ Firestore rules ด้วย emulator, marketplace worker login หรือ Android build ในรอบนี้
- ไม่รับรองว่าไม่มีบั๊กเหลือทั่วทั้งโปรเจกต์ หรือ external API จะสำเร็จ 100% ทุกครั้ง

## บทเรียนเฉพาะโปรเจกต์

- Trigger: เพิ่มขอบเขต manual recovery โดยเปลี่ยนค่าที่ automatic worker ใช้ร่วมกัน
- Action: แยกขอบเขตข้อมูลออกจากขนาด batch, claim เฉพาะชุดที่จะทำ, อ่านยืนยันทุกผลลัพธ์และตรวจ acknowledgement
- Evidence: regression tests ใน sheetSync, googleSheets และ scanCommit ครอบคลุมรายการเกิน 20, ผลลัพธ์ที่หาย, lease ที่เสียไป, storage failure และการ retry ข้าม context
- Scope: local; Status: validated; Reviewed: 2026-09-10

บันทึกตาม continuous-improvement เฉพาะใน repo นี้ ไม่เปลี่ยน AGENTS.md, skill ส่วนกลาง หรือพฤติกรรม commit/push
