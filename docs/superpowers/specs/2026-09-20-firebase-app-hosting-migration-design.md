# ย้าย Scan to Sheet ไป Firebase App Hosting

## เป้าหมาย

ย้าย production ของ Scan to Sheet จาก Vercel ไป Firebase App Hosting โดยให้หน้า Vite, API ทั้งหกเส้นทาง และค่า environment ที่จำเป็นทำงานจาก Firebase ได้ โดยคง Vercel ไว้เป็นทางย้อนกลับจนตรวจ production ใหม่ครบ

## สภาพปัจจุบัน

- Firebase Hosting เสิร์ฟ `dist` แต่ redirect ทุก path ไป Vercel
- Vercel รัน handler ใน `api/` และเก็บ session, Sheet config และ lock ใน Redis REST
- App Hosting project อยู่ที่ `hillkoff-twin-oganization`; backend ยังไม่ถูกสร้าง
- Vite ต้องรับ `VITE_*` ตอน build; server handlers ต้องรับ OAuth และ Redis credentials ตอน runtime

## แนวทาง

ใช้ Node HTTP server แบบ custom บน Firebase App Hosting: รัน Vite build, เสิร์ฟไฟล์ใน `dist`, ส่ง `/api/*` ให้ handler เดิม และคืน `index.html` สำหรับเส้นทาง SPA เช่น `/remote` การคง handler เดิมช่วยรักษาพฤติกรรม OAuth/session/lock และยังใช้ Redis service เดิมได้โดยย้าย credentials ไป App Hosting Secret Manager

กำหนด public client config เป็นค่า BUILD เท่านั้น ส่วน OAuth client secret, transaction secret และ Redis credentials อ้างผ่าน Secret Manager ห้ามบันทึกค่าจริงของ secrets ลง repository, terminal output หรือเอกสาร

## ขอบเขต

- ตั้ง production backend หนึ่งตัวใน `asia-southeast1` ที่ branch ของ repository `hillkoffzerowaste/scan-to-sheet`
- ไม่ลบ Vercel variables หรือปิด Vercel ก่อน Firebase ผ่านการตรวจ production
- ไม่ย้าย Redis data service; ย้ายเฉพาะ credentials ที่ app ใช้จริง
- เพิ่ม Firebase-host URL ใน Google OAuth/Firebase Auth configuration ก่อนให้ผู้ใช้ login ผ่านโดเมนใหม่

## ข้อจำกัดและจุดตรวจ

- App Hosting ต้องมี GitHub source connection และ backend; การให้ GitHub App เข้าถึง repository ต้องได้รับการยืนยันจากผู้ใช้ ณ เวลาที่ console ขอ
- การเปิดสิทธิ์ backend ให้ใช้ secrets และการเพิ่ม OAuth redirect/origin เป็นการเปลี่ยน access control; หยุดขอการยืนยันจากผู้ใช้ก่อนทำแต่ละรายการ
- `VITE_FIREBASE_HOSTING_URL`, `NPM_TOKEN`, `HILLKOFF_API_KEY` และ Redis aliases ที่ไม่ถูกเรียกจากเว็บ runtime ไม่อยู่ในรายการที่ app ต้องใช้
- ปล่อย `GOOGLE_OAUTH_REDIRECT_URI` ว่าง เพื่อให้ backend ตรวจ same-origin callback ได้ทั้ง `/` และ `/remote`
- App Hosting รองรับ Express/custom Node apps แบบมีเงื่อนไข; ตรวจ build/run จาก URL จริงก่อนเปลี่ยน redirect ของ Firebase Hosting

## แหล่งอ้างอิง

- [Firebase App Hosting frameworks and tooling](https://firebase.google.com/docs/app-hosting/frameworks-tooling)
- [Configure App Hosting backends and secrets](https://firebase.google.com/docs/app-hosting/configure)
- [Firebase Hosting with Cloud Run](https://firebase.google.com/docs/hosting/cloud-run)
