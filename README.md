# Scan to Sheet

เว็บแอพสำหรับสแกนเลขใบปะหน้าพัสดุเข้า Google Sheet จริงผ่าน Google Login ผู้ใช้เลือกขนส่งเองก่อนสแกน ระบบใช้ไฟล์ Google Sheet Master เพียงไฟล์เดียว และสร้างแผ่นงานตามวันที่ปัจจุบันอัตโนมัติเมื่อมีการสแกนครั้งแรกของวัน นอกจากเว็บแอพหลักแล้ว โปรเจกต์นี้ยังมี Marketplace Sync worker สำหรับดึงออเดอร์จาก Seller Center, Apps Script สำหรับจับคู่ที่อยู่ผู้รับจากใบปะหน้า, และแพ็กเกจ Android (Capacitor) สำหรับติดตั้งเป็นแอพมือถือ

## Tech stack

- Frontend: React 19 + Vite 6, `html5-qrcode` สำหรับสแกนด้วยกล้อง
- Backend/API: Vercel Serverless Functions (`api/`) สำหรับ Google OAuth และ sheet lock
- ข้อมูล: Google Sheets (Master sheet) + Firebase/Firestore (สแกนล่าสุด, marketplace orders, sync status)
- Session/lock storage: Vercel KV หรือ Upstash Redis (REST API)
- Mobile: Capacitor (Android)
- Marketplace sync: Playwright worker (Node.js) สำหรับ TikTok Shop, Shopee, Lazada Seller Center
- Label-address sync: Google Apps Script (แยกจากเว็บแอพ)
- Testing: Node.js `node --test` สำหรับ unit tests, Playwright สำหรับ e2e

## ขนส่งที่รองรับ

- Shopee
- Shopee Drop Off
- Lazada
- Lazada Flash
- TikTok Flash
- J&T
- Flash
- Best
- Ratika

## Flow การทำงาน

```text
เปิดเว็บแอพ
  -> Login ด้วย Google Mail
  -> ระบบเตรียมโฟลเดอร์ Scan to Sheet
  -> ระบบเตรียม Google Sheet Master ไฟล์เดียว
  -> ผู้ใช้เลือกขนส่ง
  -> สแกน barcode / QR
  -> ระบบดูวันที่ปัจจุบันตาม Asia/Bangkok
  -> ถ้ายังไม่มีแผ่นงานของวันนี้ ให้สร้างอัตโนมัติ
  -> ตรวจเลขซ้ำในขนส่งและวันที่เดียวกัน
  -> บันทึกแถวใหม่ลง Sheet
  -> เล่นเสียง success หรือ duplicate
```

## โครงสร้างโปรเจกต์

```text
scan to sheet/
  api/                      Vercel serverless functions (Google OAuth, session, sheet lock)
  android/                  Capacitor Android project
  apps-script/label-sync/   Google Apps Script: จับคู่ที่อยู่ผู้รับจากใบปะหน้า
  docs/                     เอกสารสรุปโปรเจกต์และ workflow
  public/                   Static assets, PWA manifest, service worker
  scripts/label-sync/       ต้นทางไฟล์ .gs (sync กับ apps-script/label-sync)
  scripts/marketplace-sync/ Playwright worker + local dashboard สำหรับ sync ออเดอร์
  src/                      React app (UI, services)
  src/services/             Logic เชื่อม Firebase, Google Sheets, marketplace import, scan commit ฯลฯ
  tests/e2e/                Playwright end-to-end tests
```

## โครงสร้าง Google Drive

```text
Scan to Sheet/
  Scan to Sheet Master
```

ในไฟล์ Master จะมีแผ่นงานตามวันที่ เช่น `2026-06-24`, `2026-06-25`

## คอลัมน์ในแผ่นงาน

```text
No.
Courier No.
Scan Date
Scan Time
Courier
Tracking / Barcode
Scanner Email
Packer
Status
Remark / Issue
```

แผ่นงานรายวันจะ freeze แถวหัวตาราง และเปิด filter อัตโนมัติ เพื่อกรองคอลัมน์ `Courier` ใน Google Sheet ได้ทันที โดย `No.` เป็นลำดับรวมทั้งวัน, `Courier No.` เป็นลำดับเฉพาะขนส่งนั้นในวันเดียวกัน, `Packer` เก็บชื่อเล่นของพนักงานที่เลือกเป็นผู้แพ็ค และ `Remark / Issue` ใช้บันทึกปัญหา เช่น `ลูกค้ายกเลิก`

## Google Cloud setup

สร้าง OAuth client ใน Google Cloud Console:

```text
Application type: Web application
Authorized JavaScript origins:
  http://127.0.0.1:5173
  https://scan-to-sheet-ten.vercel.app

Authorized redirect URIs:
  http://127.0.0.1:5173/
  https://scan-to-sheet-ten.vercel.app/
```

เปิด API:

```text
Google Drive API
Google Sheets API
```

Scopes ที่ใช้:

```text
openid
email
profile
https://www.googleapis.com/auth/drive.file
https://www.googleapis.com/auth/spreadsheets
```

## Firebase setup

โปรเจกต์ใช้ Firebase Authentication สำหรับยืนยันตัวตน, Firestore สำหรับข้อมูลสแกน ออเดอร์ marketplace และข้อมูลพนักงาน, และ Firebase Storage สำหรับรูปประจำตัวพนักงาน ต้องสร้าง Firebase Web App และเติมค่า `VITE_FIREBASE_*` ใน `.env` (ดู `.env.example`)

เปิดใช้งาน Google sign-in ใน Firebase Authentication และสร้าง Firestore Database กับ Storage bucket ก่อนใช้งาน ระบบพนักงานใช้ collection หลักดังนี้:

- `staffMembers`: ข้อมูลสาธารณะและข้อมูลติดต่อแบบปกปิด
- `staffPrivateContacts` และ `staffPrivateNotes`: ข้อมูลสำหรับ Admin เท่านั้น
- `staffDutyTypes`: ประเภทงาน
- `staffWeeklyDuties`: ตารางเวรประจำสัปดาห์ (ตายตัว มีผลทุกสัปดาห์) ใช้เป็นหน้าที่หลักของแต่ละวัน
- `staffDutyOverrides`: การเปลี่ยนคนทำแทนหรืองดเวร เฉพาะวันนั้น (doc id = `วันที่__weeklyDutyId`) ไม่กระทบตารางหลัก
- `staffDailyAssignments`: งานเพิ่มเฉพาะวันที่อยู่นอกตาราง
- `staffDailyStatuses` และ `staffDailyLeads`: สถานะและผู้ช่วยหัวหน้าประจำวัน
- `staffSettings/packingRoomNotice`: ประกาศและกฎระเบียบห้องแพ็ค

แต่งตั้ง Admin คนแรกโดยนำ Firebase Authentication UID ของผู้ใช้ไปสร้าง document `adminUsers/{uid}` ใน Firestore ข้อมูลใน document จะเป็น object ว่างก็ได้ หลังจากนั้นผู้ใช้ต้องออกจากระบบและเข้าสู่ระบบใหม่

สำหรับ Marketplace Sync worker ต้องดาวน์โหลด service account key จาก Firebase Console > Project settings > Service accounts แล้วบันทึกเป็น `firebase-service-account.json` ที่ root ของโปรเจกต์ (ไฟล์นี้อยู่ใน `.gitignore` ห้าม commit)

## Environment variables

สร้างไฟล์ `.env` จากตัวอย่างใน `.env.example`:

```text
VITE_GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MEASUREMENT_ID=...
VITE_FIREBASE_HOSTING_URL=...

KV_REST_API_URL=...
KV_REST_API_TOKEN=...
```

`KV_REST_API_URL` / `KV_REST_API_TOKEN` มาจาก Vercel KV หรือ Upstash Redis ใช้สำหรับเก็บ session และ sheet lock ฝั่ง API

## Run locally

```bash
npm install
npm run dev
```

## Testing

```bash
npm run test:marketplace   # unit tests: marketplace sync, Firestore, Google Sheets, scan services
npm run test:rules         # regression tests สำหรับ Firestore security rules
npm run test:label-sync    # unit tests: label parser และ matching
npm run test:e2e           # Playwright end-to-end
npm run test:e2e:ui        # Playwright UI mode
npm run test:e2e:chromium  # Playwright เฉพาะ Chromium
npm run build              # ตรวจ production build ก่อน deploy
```

## Deploy

### Vercel (เว็บแอพหลัก + API)

ตั้ง Environment Variable ใน Vercel:

```text
VITE_GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
```

หลังเพิ่มหรือแก้ environment variable ต้อง redeploy ใหม่

### Firebase rules และ Storage

```bash
firebase deploy --only firestore:rules,storage --project hillkoff-twin-oganization
```

คำสั่งนี้ deploy สิทธิ์ Firestore และ Storage เท่านั้น ควรรันเมื่อแก้ `firestore.rules` หรือ `storage.rules`

### Firebase Hosting (redirect ไป Vercel)

```bash
npm run firebase:deploy    # build + deploy hosting
npm run firebase:preview   # build + deploy preview channel (7 วัน)
npm run firebase:serve     # build + รันผ่าน emulator ในเครื่อง
```

Hosting site `hillkoff-twin-oganization` ตั้งค่าให้ redirect ไปเว็บ Production หลักที่ `https://scan-to-sheet-ten.vercel.app` คำสั่งในส่วนนี้ไม่ได้ deploy Firestore หรือ Storage rules

## Android app (Capacitor)

โปรเจกต์ Android อยู่ที่ `android/` โดย config หลักอยู่ที่ `capacitor.config.json` (`appId: com.scantosheet.app`) แอพเปิดเป็น WebView ที่ชี้ไปยัง URL ที่ deploy ไว้ (`server.url`) ใช้ Android Studio หรือ Gradle wrapper (`android/gradlew`) ในการ build/run

## Marketplace Sync worker

Playwright worker (Node.js) สำหรับดึงข้อมูลออเดอร์จาก Seller Center ของ TikTok Shop, Shopee, Lazada เข้า Firestore โดยรันบนเครื่อง PC หน้าร้านและ sync ทุก 5 นาทีเป็นค่าเริ่มต้น รายละเอียดการติดตั้งและใช้งานทั้งหมดอยู่ใน [scripts/marketplace-sync/README.md](scripts/marketplace-sync/README.md) สรุปคำสั่งหลัก:

```bash
npm run marketplace:login -- all      # login ทุกแพลตฟอร์มครั้งแรก
npm run marketplace:sync:once         # sync ครั้งเดียวเพื่อทดสอบ
npm run marketplace:sync              # sync ต่อเนื่องทุก 5 นาที
npm run marketplace:dashboard         # เปิด dashboard ที่ http://127.0.0.1:8787
```

ออเดอร์ถูก upsert เข้า collection `marketplaceOrders` และจับคู่กับเลขพัสดุที่สแกนแล้วโดยอัตโนมัติ (`normalizedTrackingNo` กับ `orders.normalizedCode`)

## Label-address sync (Google Apps Script companion)

เว็บแอพหลักรับผิดชอบเฉพาะการสแกน ส่วนงานจับคู่ที่อยู่ผู้รับทำโดย Apps Script แยกต่างหาก ที่อ่านไฟล์ใบปะหน้า (PDF/รูปภาพ) จาก Google Drive ทุก 15 นาที จับคู่ Marketplace Platform และ Order ID ในคอลัมน์ N/O แล้วเขียนคอลัมน์ P เป็น `recipient name | recipient address` ขั้นตอนติดตั้งและการอนุญาตสิทธิ์อยู่ใน [apps-script/label-sync/README.md](apps-script/label-sync/README.md)

## UI และ PWA

- มีปุ่มเลือก Light/Dark mode และจำค่าด้วย `localStorage`
- Layout ออกแบบแบบ mobile-first สำหรับใช้งานบนมือถือหรือเครื่องยิงสแกน
- มี Web App Manifest และ Service Worker สำหรับติดตั้งเป็น PWA

## Scan modes

- เลือกได้ระหว่างเครื่องยิง/พิมพ์เอง หรือกล้องมือถือ
- กล้องมือถือมีกรอบเล็งกลางจอสำหรับวางบาร์โค้ดหลักให้อยู่ในช่องก่อนอ่านค่า
- เลือกได้ทั้งแบบทีละรายการ และแบบต่อเนื่องสำหรับออเดอร์เยอะ
- Lazada รับเฉพาะเลขที่ขึ้นต้นด้วย `LEX`
- Lazada Flash รับเฉพาะเลขที่ขึ้นต้นด้วย `TH`
- TikTok Flash รับเลขที่ขึ้นต้นด้วย `THT` เช่น `THT64095CD1Y40Z` และรองรับตัวอักษรผสมตัวเลข
- ถ้าอ่านเจอบาร์โค้ดอื่นในใบปะหน้า ระบบจะแจ้งว่าไม่ใช่บาร์โค้ดหลักและไม่บันทึกลง Sheet
- รายการล่าสุดแสดง 3 รายการแรกของวันนี้ก่อน และกดดูเพิ่มเติมได้เมื่อต้องไล่รายการยาวขึ้น
- เลือก Packer ก่อนสแกนจากพนักงาน active ในแผนผังห้องแพ็ค โดยหัวหน้า, Checker และ Packer สามารถถูกเลือกเป็นผู้แพ็คได้ในกรณีช่วยงานเร่งด่วน ค่าเริ่มต้นคือ `ยังไม่ระบุ`
- กดปุ่ม `ลูกค้ายกเลิก` ก่อนสแกน ถ้าเลขมีอยู่แล้วระบบจะอัปเดตแถวเดิมเป็น `Cancelled`; ถ้ายังไม่มีจะบันทึกแถวใหม่เป็นข้อมูลยกเลิก

## Parcel lookup

- ค้นหาเลขพัสดุได้จากส่วน Lookup เหนือพื้นที่สแกน
- เลือกค้นหาเฉพาะขนส่งที่เลือก หรือทุกขนส่ง
- เลือกช่วงข้อมูลเป็นวันนี้ ช่วงวันที่ หรือทุกแผ่นงานวันที่ที่มีอยู่
- ผลค้นหาแสดงขนส่ง วันที่ เวลา เลขพัสดุ และผู้สแกน โดยไม่บันทึกข้อมูลเพิ่ม

## Reports

- รายงานประจำวัน เลือกวันที่เดียวแล้วสรุปยอดทุกขนส่ง
- รายงานช่วงวันที่ เลือกวันเริ่มต้นและวันสิ้นสุด
- รายงานรายเดือน เลือกเดือนแล้วสรุปยอดทั้งเดือน
- รายงานดึงข้อมูลจาก Google Sheet Master โดยตรง แล้วสรุปแยกตามขนส่ง
- หลังสร้างรายงานแล้วกดคัดลอกรายงานเพื่อนำข้อความไปวางใน Gmail, LINE หรือแชตงานได้ทันที

## แผนผังพนักงานห้องแพ็ค

- ผู้ใช้ที่เข้าสู่ระบบทุกคนมองเห็นรายชื่อ รูป ตำแหน่ง สถานะ และหน้าที่ประจำวัน
- หัวหน้าแสดงบนสุด ส่วน Checker และ Packer แสดงรวมกันตามลำดับที่ Admin กำหนด
- Admin เพิ่ม แก้ไข ปิดใช้งาน อัปโหลดรูป และลากจัดลำดับพนักงานภายในตำแหน่งเดียวกันได้
- Admin กำหนดประเภทงาน หน้าที่ สถานะรายวัน และผู้ช่วยหัวหน้าประจำวันได้ โดยพนักงาน active มีสถานะเริ่มต้นเป็น `ปฏิบัติงาน`
- ผู้ใช้ทั่วไปเห็นข้อมูลติดต่อแบบปกปิด ส่วน Admin เห็นข้อมูลติดต่อฉบับเต็ม
- ประกาศและกฎระเบียบห้องแพ็คแสดงร่วมกับแผนผังและแก้ไขได้โดย Admin
- ปุ่ม `คัดลอกสรุปรายงาน` สร้างข้อความของวันที่เลือก ประกอบด้วยยอดสรุป หัวหน้า ผู้ช่วย รายชื่อ สถานะ หน้าที่ และประกาศ โดยไม่รวมข้อมูลติดต่อ

## Security

- ห้าม commit `.env`, `firebase-service-account.json`, `scripts/marketplace-sync/config.json`, browser profile, log, screenshot ของ marketplace worker และไฟล์สำรองข้อมูลใน `.codex-tmp` (อยู่ใน `.gitignore` แล้ว)
- Session และ sheet lock เก็บผ่าน Vercel KV/Upstash Redis ฝั่ง server เท่านั้น ไม่เก็บ token ฝั่ง client
- Firestore ควบคุมสิทธิ์ผ่าน `firestore.rules` และรูปพนักงานควบคุมสิทธิ์ผ่าน `storage.rules`
- ข้อมูลติดต่อฉบับเต็มเก็บใน `staffPrivateContacts` ซึ่งอ่านได้เฉพาะ Admin ส่วน `staffMembers` เก็บเฉพาะค่าที่ปกปิดแล้ว
- `firebase-service-account.json` และ credential อื่นต้องใช้งานฝั่ง server เท่านั้น ห้ามฝังใน frontend หรือ commit เข้า Git
