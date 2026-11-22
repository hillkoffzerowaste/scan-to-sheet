# การนับการสแกนซ้ำ

Firestore เป็นแหล่งข้อมูลหลักสำหรับจำนวนการสแกนจริง แยก Admin และ Packer ตามเลขพัสดุที่ trim และ uppercase แล้วแบบตรงตัว ไม่รวมเลขคล้ายกันเป็นเลขเดียว จำนวนซ้ำของแต่ละฝ่ายเท่ากับ `max(total - 1, 0)` เมื่อทั้งสองฝ่ายมากกว่า 1 ครั้ง จะแสดง “เสี่ยงทำออเดอร์ซ้ำ ต้องตรวจสอบ” ข้อความนี้ไม่ยืนยันว่ามีสินค้าหลายชิ้น

หนึ่งการกดสแกนมี attempt ID ที่เก็บในเครื่องก่อนส่ง การ retry ต้องใช้ ID และบริบทเดิม การบันทึก receipt, canonical pointer, จำนวน และสถานะออเดอร์อยู่ใน transaction เดียว การ replay receipt เดิมไม่เพิ่มจำนวน การเปลี่ยน actor, role, tracking, date, courier หรือ source ด้วย ID เดิมจะถูกปฏิเสธ

ข้อมูลเดิมที่มี scan แต่ไม่มี counters ใช้จำนวนที่พิสูจน์ได้อย่างน้อยหนึ่งครั้งต่อฝ่ายและตั้ง `scanHistoryUnknown: true` ไม่สมมติว่ารู้ประวัติทั้งหมด หากพบหลายออเดอร์ที่ใช้เลขเดียวกัน หรือพบเฉพาะ scanEvents ที่ยังไม่ได้รวมเป็นออเดอร์ ระบบหยุดให้ตรวจสอบก่อน เพื่อไม่ทิ้งฝ่ายสแกนหรือแถว Sheet เดิม

Google Sheet คง A:W เดิม และเพิ่ม X Admin Total, Y Packer Total, Z Admin Duplicate, AA Packer Duplicate, AB History Unknown, AC Count Revision และ AD Duplicate Risk การ sync เขียนยอด absolute ไม่ใช้การบวกใน Sheet และอ่านกลับก่อนยืนยัน revision หากมีสแกนใหม่ระหว่าง sync การตอบกลับของ revision เก่าจะไม่ยืนยัน revision ใหม่ สีเตือนใช้ conditional formatting เฉพาะ Tracking F เมื่อ Packer มากกว่า 1 และ M เมื่อ Admin มากกว่า 1 โดยเก็บกฎ custom ของผู้ใช้ไว้ ส่วนข้อความเตือนทำออเดอร์ซ้ำต้องมีทั้งสองฝ่ายมากกว่า 1

ผู้เรียก writer ต้องใช้ Sheet lock เดียวกับ `runWithGoogleRetry(..., { sheetWrite: true })` ตลอดการเขียนและอ่านกลับ ทั้ง foreground wrapper และ recovery batch ทำงานภายใน lock ของผู้เรียก ไม่สร้าง nested lock ที่อาจรอค้าง การตรวจ revision ของ Sheet ภายใน lock ปฏิเสธ snapshot ที่เก่ากว่ายอดที่เขียนอยู่แล้ว และ Firestore ตรวจ revision อีกครั้งตอนรับ acknowledgement

## ก่อนเปิดใช้งาน

- เผยแพร่ Firestore rules ที่รองรับ collections และ fields ใหม่ก่อนใช้ client ใหม่
- ปิดหรืออัปเดต client เก่าทุกเครื่องก่อนเปิดนับจริง เพราะ client เก่าไม่สร้าง attempt/receipt จึงนับ physical scan ไม่ครบ แม้การเขียน A:W ของ client เก่าจะไม่ลบ X:AD ก็ตาม
- ตรวจและ backfill ประวัติที่มีเฉพาะ Google Sheet ก่อนเริ่มนับ ข้อมูลที่ไม่มีทั้ง order และ event ใน Firestore ไม่สามารถตรวจพบจาก transaction ของ Firestore ได้ จึงไม่สามารถรับรองประวัติของรายการเหล่านั้นย้อนหลัง
- แก้ legacy collisions ด้วยการตรวจฝ่ายสแกนและแถว Sheet เดิมก่อนสร้าง canonical pointer ห้ามรวมข้อมูลเงียบ ๆ
- เก็บ receipts ตลอดระยะเวลาที่อนุญาตให้ replay คิวเก่า การลบ receipt อาจทำให้ retry เดิมถูกนับใหม่ รุ่นนี้ไม่มี automatic deletion หรือ TTL ของ receipts

ไม่ได้ deploy rules หรือแอป และไม่ได้เปลี่ยนข้อมูลจริงจากการแก้โค้ดครั้งนี้
