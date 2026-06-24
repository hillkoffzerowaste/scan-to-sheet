# Scan to Sheet

เว็บแอพสำหรับสแกนเลขใบปะหน้าพัสดุเข้า Google Sheet จริงผ่าน Google Login ผู้ใช้เลือกขนส่งเองก่อนสแกน ระบบใช้ไฟล์ Google Sheet Master เพียงไฟล์เดียว และสร้างแผ่นงานตามวันที่ปัจจุบันอัตโนมัติเมื่อมีการสแกนครั้งแรกของวัน

## ขนส่งที่รองรับ

- Shopee
- Shopee Drop Off
- Lazada
- Lazada Flash
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
Status
Note
```

แผ่นงานรายวันจะ freeze แถวหัวตาราง และเปิด filter อัตโนมัติ เพื่อกรองคอลัมน์ `Courier` ใน Google Sheet ได้ทันที โดย `No.` เป็นลำดับรวมทั้งวัน และ `Courier No.` เป็นลำดับเฉพาะขนส่งนั้นในวันเดียวกัน

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

## Run locally

สร้างไฟล์ `.env`:

```text
VITE_GOOGLE_CLIENT_ID=your-web-oauth-client-id.apps.googleusercontent.com
```

แล้วรัน:

```bash
npm install
npm run dev
```

## Deploy on Vercel

ตั้ง Environment Variable ใน Vercel:

```text
VITE_GOOGLE_CLIENT_ID=your-web-oauth-client-id.apps.googleusercontent.com
```

หลังเพิ่มหรือแก้ environment variable ต้อง redeploy ใหม่

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
- ถ้าอ่านเจอบาร์โค้ดอื่นในใบปะหน้า ระบบจะแจ้งว่าไม่ใช่บาร์โค้ดหลักและไม่บันทึกลง Sheet
- รายการล่าสุดแสดง 3 รายการแรกของวันนี้ก่อน และกดดูเพิ่มเติมได้เมื่อต้องไล่รายการยาวขึ้น

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
