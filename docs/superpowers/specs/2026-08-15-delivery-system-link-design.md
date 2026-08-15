# ระบบส่งของ link-only design

## เป้าหมาย

Scan to Sheet ต้องมีเมนู sidebar ชื่อ **ระบบส่งของ** ที่พาผู้ใช้ไปยัง `https://repo-rho-livid.vercel.app/` ในแท็บใหม่ เพื่อใช้งานระบบจัดส่งที่แอปต้นทางโดยตรง

## ขอบเขต

- แทนที่ Sales Quick Desk ด้วย external link ที่มี `target="_blank"` และ `rel="noopener noreferrer"` เพื่อไม่ให้แท็บ Scan to Sheet สูญเสียงานค้าง
- เอา embedded sales workspace ออกจาก `App.jsx` และ stylesheet ของ Scan to Sheet
- ลบ gateway `/api/hillkoff`, client ที่เรียก API v1, shared sales feature, tests และ dependency `@hillkoffzerowaste/sales-workspace`
- เอา `HILLKOFF_API_KEY` ออกจากเอกสาร setup ของ Scan to Sheet เพราะแอปไม่เรียกใช้อีกต่อไป
- คงเอกสารแผนเก่าไว้เป็นประวัติ และไม่แตะฟังก์ชัน scan, Drive, report หรือไฟล์งานที่ผู้ใช้ยังไม่ได้ commit

## การทำงานและความปลอดภัย

คลิกเมนูระบบส่งของเปิดแอปต้นทางในแท็บใหม่เท่านั้น ไม่มี request ไปยัง `/api/hillkoff` หรือ `/api/v1` จาก Scan to Sheet อีก ลิงก์มีข้อความเข้าถึงได้ชัดเจนและใช้มาตรการ `noopener` เพื่อไม่ให้หน้าใหม่เข้าถึง `window.opener`

## การตรวจสอบ

- E2E ยืนยันชื่อเมนู, URL, new-tab policy และไม่มี sales pane ในหน้า Scan to Sheet
- Unit/API suite ไม่เหลือ import หรือ command ที่ผูก Hillkoff gateway
- Vite build ผ่าน และ browser suite เดิมของ Scan to Sheet ผ่าน

## นอกขอบเขต

ไม่แก้ environment variable บน Vercel โดยตรง เพราะเป็นการแก้ production configuration แยกต่างหาก; เมื่อลบโค้ดแล้ว `HILLKOFF_API_KEY` จะไม่ถูกใช้งานในแอปนี้
