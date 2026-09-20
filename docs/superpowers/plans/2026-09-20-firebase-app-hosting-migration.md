# Firebase App Hosting Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** ย้ายเว็บ Scan to Sheet และ API เดิมไป Firebase App Hosting พร้อมผูก production environment ที่จำเป็นอย่างปลอดภัย

**Architecture:** เพิ่ม Node HTTP server สำหรับเสิร์ฟ Vite `dist` และเรียก Vercel handlers เดิมตาม `/api/*`; ตั้ง App Hosting ด้วย custom build/run commands. ค่า client อยู่เฉพาะช่วง build และ server secrets อ้างจาก Firebase Secret Manager

**Tech Stack:** Node.js ESM, Vite, Firebase App Hosting, Cloud Secret Manager, Firebase CLI

**Spec:** `docs/superpowers/specs/2026-09-20-firebase-app-hosting-migration-design.md`

## Global Constraints

- คง Vercel และ environment เดิมไว้จน Firebase production ผ่านการตรวจ
- ห้ามบันทึกค่า secret จริงใน repository หรือ output ที่แสดงต่อผู้ใช้
- ต้องเก็บ route `/remote` และ API contract เดิม
- เพิ่ม authorized origin/redirect ของ Firebase ก่อนทดสอบ OAuth; คง Vercel URI ไว้ระหว่าง cutover
- ทำตาม `AGENTS.md`; รัน `npm run test:marketplace` และ `npm run build` ก่อนรายงานเสร็จ

## Review Focus

- `POST` body ไม่ถูก parse หรือเกินขนาดแล้ว API ต้องคืน JSON ไทยพร้อม error code ที่เสถียร
- cookies หลายค่าใน Google OAuth ต้องส่งกลับครบผ่าน Node HTTP response
- `/remote`, static assets และ 404 ของ `/api/*` ต้องไม่ตกไปผิด handler
- App Hosting ต้องใช้ URL จริงของ backend ตอนสร้าง `VITE_PRIMARY_APP_URL` และ callback ต้องใช้ origin เดียวกัน
- secrets ที่ไม่ถูกเรียกโดยเว็บ runtime ต้องไม่ถูกผูกให้ backend อ่าน

---

### Task 1: Node HTTP adapter สำหรับหน้าเว็บและ API

**Files:**
- Create: `server.js`
- Create: `api/nodeServer.test.js`
- Modify: `package.json`

**Interfaces:**
- `createAppServer({ staticDir, apiHandlers })` คืน Node `http.Server`; production ใช้ handlers ทั้งหกจาก `api/`
- route API ที่ไม่มีอยู่คืน `404` JSON; route SPA คืน `dist/index.html`

- [ ] เพิ่ม tests สำหรับ `GET /api/google-token` ที่คืน `NO_GOOGLE_SESSION`, SPA fallback `/remote`, และ static asset
- [ ] รัน `node --test api/nodeServer.test.js` ให้แดงจาก `createAppServer` ที่ยังไม่มี
- [ ] เพิ่ม handler dispatch, JSON body parsing แบบจำกัดขนาด, static file serving และ `PORT` listener
- [ ] รัน `node --test api/nodeServer.test.js` ให้ผ่าน

### Task 2: ตั้งค่า App Hosting

**Files:**
- Create: `apphosting.yaml`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- `apphosting.yaml` ใช้ `npm run build`, `node server.js` และอ้างเฉพาะ secrets ที่ API ใช้จริง
- client `VITE_*` เป็น BUILD variables; `GOOGLE_CLIENT_SECRET`, `OAUTH_TRANSACTION_SECRET` และ `KV_REST_API_TOKEN` เป็น Secret Manager references

- [ ] กำหนด build/run command และ Node runtime ที่รองรับใน App Hosting
- [ ] ระบุ OAuth redirect URI ให้ resolve จาก host ของ request; ไม่ตั้งค่า URI เดียวที่ตัด `/remote`
- [ ] อัปเดต README เรื่อง deploy, config และข้อจำกัด Vercel rollback
- [ ] รัน `npm run test:marketplace` และ `npm run build`

### Task 3: ย้าย production config และตรวจ Firebase

**External setup:** Firebase App Hosting backend ใน `asia-southeast1`, Firebase Secret Manager, Google OAuth client และ Firebase Authentication authorized domains

- [ ] เชื่อม repository/branch กับ Firebase App Hosting; หยุดให้ผู้ใช้อนุมัติเมื่อ console ขอสิทธิ์ GitHub App
- [ ] ย้ายเฉพาะ production keys ที่ source ใช้จริง โดยเก็บ secrets ใน Secret Manager และค่า client ที่ BUILD scope
- [ ] หยุดขอผู้ใช้ยืนยันก่อนให้ backend อ่าน secrets และก่อนเพิ่ม OAuth/Auth allowlist
- [ ] deploy/rollout backend และตรวจหน้า root, `/remote`, API unauthenticated responses และ OAuth start URL โดยไม่ทำรายการสแกนจริง
- [ ] เปลี่ยน Firebase Hosting redirect ไป backend ใหม่หลัง smoke check ผ่าน; คง Vercel variables ไว้สำหรับ rollback
