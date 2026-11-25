# การเชื่อมกับ Delivery System และ LINE

Scan to Sheet เป็นเว็บแอพปลายทางสำหรับข้อมูลสแกนและ Google Sheets แยก host และ Firebase project จาก Delivery System อย่างอิสระ

## ขอบเขตของแอพ

| แอพ | Firebase project | App Hosting backend | หน้าที่ |
| --- | --- | --- | --- |
| Delivery System | `hillkoff-delivery` | `delivery-system` | รับ webhook จาก LINE OA และตอบคำสั่งห้องแพ็ค |
| Scan to Sheet | `hillkoff-twin-oganization` | `scan-to-sheet` | สแกนเลขพัสดุ, เขียน Google Sheets และรับ event ที่ Delivery ส่งต่อ |

Production URL ของแอพนี้คือ:

`https://scan-to-sheet--hillkoff-twin-oganization.asia-southeast1.hosted.app`

## Endpoint รับ event จาก Delivery

```text
POST /api/line-events
```

Delivery เรียก endpoint นี้เมื่อ event มาจากกลุ่ม LINE ที่ได้รับอนุญาตแล้ว โดยแนบ secret ผ่าน header `x-line-forward-secret` การเรียกที่ไม่มี header หรือค่าไม่ถูกต้องจะตอบ `401` และไม่บันทึกข้อมูล

ข้อมูลที่รับจะถูกตัดข้อมูลลับก่อนบันทึกใน Firestore collection `lineWebhookEvents` เพื่อใช้ตรวจสอบการเชื่อมต่อและประวัติ event โดยไม่เก็บ access token หรือ reply token

## การแยกค่าตั้งค่า

ค่าของ Scan to Sheet ต้องอยู่ใน project/backend นี้เท่านั้น:

- `LINE_FORWARD_SECRET` — secret สำหรับตรวจ event ที่ส่งมาจาก Delivery
- `GOOGLE_CLIENT_SECRET` และ `OAUTH_TRANSACTION_SECRET` — secret ของการทำงานใน Scan to Sheet
- ข้อมูล LINE channel และ allowlist ของกลุ่มอยู่ฝั่ง Delivery ไม่ต้องคัดลอกมาที่แอพนี้

ห้ามผูก `LINE_FORWARD_SECRET` ใน backend `delivery-system` และห้ามตั้ง LINE OA webhook ให้ชี้มาที่ Scan to Sheet โดยตรง

## การทำงานร่วมกัน

```text
LINE OA -> Delivery /api/line/webhook
             | ตอบคำสั่งและการ์ดให้ผู้ใช้
             v
      Scan to Sheet /api/line-events
             |
             v
      Firestore lineWebhookEvents
```

การส่งต่อเป็น one-way จาก Delivery มายัง Scan to Sheet แอพนี้จึงไม่ตอบข้อความ LINE ซ้ำ และยังเปิดให้สแกน/ใช้งาน Google Sheets ได้แม้ไม่มี LINE event ใหม่

## ตรวจสอบหลัง deploy

1. ตรวจว่า rollout ของ backend `scan-to-sheet` อยู่ใน project `hillkoff-twin-oganization`
2. เรียก endpoint โดยไม่มี header ต้องได้ `401`
3. เรียกด้วย secret ผ่าน environment ของ backend ต้องได้ `200` และบันทึก event ที่ตัดข้อมูลลับแล้ว
4. ทดสอบจากกลุ่ม LINE ที่ allow ไว้ แล้วตรวจว่ามี event ใหม่ใน `lineWebhookEvents`
5. กลุ่มที่ไม่อยู่ใน allowlist ต้องไม่ปรากฏใน collection นี้

ห้ามใส่ค่า secret จริงใน README, commit, issue หรือข้อความแชท
