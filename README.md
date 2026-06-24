# Scan to Sheet

เว็บแอพสำหรับสแกนเลขใบปะหน้าพัสดุเข้า Google Sheet จริงผ่าน Google Login ผู้ใช้เลือกขนส่งเองก่อนสแกน ระบบจะแยกไฟล์ตามขนส่ง 8 รายการ และสร้างแผ่นงานตามวันที่ปัจจุบันอัตโนมัติเมื่อมีการสแกนครั้งแรกของวัน

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
  -> ระบบเตรียม Google Sheet ของขนส่งทั้ง 8 ไฟล์
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
  Shopee
  Shopee Drop Off
  Lazada
  Lazada Flash
  J&T
  Flash
  Best
  Ratika
```

ในแต่ละไฟล์จะมีแผ่นงานตามวันที่ เช่น `2026-06-24`, `2026-06-25`

## คอลัมน์ในแผ่นงาน

```text
No.
Scan Date
Scan Time
Tracking / Barcode
Scanner Email
Status
Note
```

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
