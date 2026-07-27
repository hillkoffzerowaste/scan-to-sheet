# Customer Label Address Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทุก 15 นาที อ่านใบปะหน้า Shopee/Lazada/TikTok จาก Google Drive จับคู่ Order ID กับคอลัมน์ O และเขียน `ชื่อผู้รับ | ที่อยู่` ลงคอลัมน์ P โดยเขียนทับได้

**Architecture:** โครงการปัจจุบันเป็น React/Vite + Node worker และไม่มี Google Apps Script เดิม จึงเพิ่ม Apps Script companion แยกเป็นงาน scheduled backend ใช้สิทธิ์บัญชี Google เดียวกับ Drive/Sheet โดยไม่พึ่ง access token ใน browser และไม่แก้ flow สแกนเดิม แอปสคริปต์จะอ่านไฟล์ใหม่แบบ recursive, แปลง PDF/รูปเป็นข้อความด้วย Drive OCR, แยกใบปะหน้าตามแพลตฟอร์ม, อัปเดต Sheet และบันทึก audit log/idempotency state

**Tech Stack:** Google Apps Script, Drive Advanced Service/DriveApp, DocumentApp, SpreadsheetApp, LockService, PropertiesService, Node `node:test` สำหรับทดสอบ parser แบบ pure text

## Global Constraints

- คอลัมน์ O เป็น Order ID และคอลัมน์ P ต้องมีรูปแบบ `ชื่อผู้รับ | ที่อยู่`
- อนุญาตให้เขียนทับค่าคอลัมน์ P เมื่อจับคู่ได้
- ตั้งเวลาให้ทำงานทุก 15 นาทีด้วย installable time-driven trigger
- ต้องรองรับ PDF เดียวที่มีหลายใบปะหน้า เช่น Shopee ตัวอย่างมี 2 ใบ
- ต้องไม่เขียนข้อมูลเมื่อไม่มี Order ID, ไม่มีชื่อ/ที่อยู่ที่เชื่อถือได้, หรือพบข้อมูลขัดแย้งหลายชุด
- ต้องเก็บสถานะไฟล์ที่ประมวลผลแล้วและผลลัพธ์ที่จับคู่ไม่ได้ โดยไม่บันทึกที่อยู่เต็มลง log
- ห้ามใส่ credential, refresh token, service-account JSON หรือข้อมูลลูกค้าลง Git
- การเขียนต้องมี script lock ป้องกัน trigger ซ้อน และต้องประมวลผลซ้ำได้อย่างปลอดภัย

---

### Task 1: สร้าง parser core และ fixture tests

**Files:**
- Create: `apps-script/label-sync/LabelParser.gs`
- Create: `scripts/label-sync/labelParser.test.js`
- Create: `scripts/label-sync/fixtures/shopee.txt`
- Create: `scripts/label-sync/fixtures/lazada.txt`
- Create: `scripts/label-sync/fixtures/tiktok.txt`

**Interfaces:**
- `normalizeLabelText_(text)` -> `string`
- `normalizeOrderId_(platform, value)` -> `string`
- `parseLabels_(text, fileName)` -> `Array<{platform: string, orderId: string, recipientName: string, address: string, combined: string}>`
- `formatRecipient_(name, address)` -> `string`

- [ ] **Step 1: บันทึก fixture ข้อความจาก PDF จริง** โดยคง marker สำคัญ เช่น `Shopee Order No.`, `Order No.`, `Customer NAME`, `ADDRESS`, `Order ID`, `ถึง`, `ผู้รับ (TO)` และตัดข้อมูลสินค้า/โทรศัพท์ที่ไม่ต้องเขียนลง P
- [ ] **Step 2: เขียน failing tests** ให้ตรวจผลลัพธ์ที่คาดหวังจากไฟล์ตัวอย่าง: Shopee 2 labels (`260726P6WBVFGG`, `260727PSKK15RN`), Lazada (`1117718175852180`), TikTok (`585225626528745423`)
- [ ] **Step 3: รัน test ก่อนเขียน implementation**

Run: `node --test scripts/label-sync/labelParser.test.js`

Expected: FAIL เพราะ parser functions ยังไม่มี

- [ ] **Step 4: เขียน parser แบบ pure text**
  - normalize ช่องว่าง, BOM, null character และอักขระควบคุมจาก PDF
  - split Shopee ด้วย marker `Shopee Order No.` และรองรับ marker ที่อยู่ท้ายบรรทัดสินค้า
  - Lazada อ่าน `Order No.`, `Customer NAME` และ `ADDRESS` จนถึง `Phone number`
  - TikTok อ่าน `Order ID`, ชื่อหลัง `ถึง` และ address block ก่อน `PICK-UP`/ก่อน `Order ID`
  - Shopee อ่านชื่อ/ที่อยู่ใน block `ผู้รับ (TO)` เท่านั้น ไม่ดึง block `ผู้ส่ง (FROM)`
  - ตัดเบอร์โทรศัพท์ออกจากผลลัพธ์ และสร้าง `combined` เป็น `ชื่อ | ที่อยู่`
  - หากพบ Order ID เดียวกันหลาย block ให้ส่งกลับทุก block เพื่อให้ชั้น sync ตรวจความขัดแย้ง
- [ ] **Step 5: รัน test ให้ผ่าน**

Run: `node --test scripts/label-sync/labelParser.test.js`

Expected: PASS พร้อมเคส normalization, multi-label Shopee, missing field และ conflicting duplicate

---

### Task 2: สร้าง Apps Script runtime สำหรับ Drive OCR และ file state

**Files:**
- Create: `apps-script/label-sync/Code.gs`
- Create: `apps-script/label-sync/appsscript.json`
- Create: `apps-script/label-sync/README.md`

**Interfaces:**
- `setupLabelSync()` -> `void`
- `runLabelSync()` -> `{filesScanned: number, labelsFound: number, rowsUpdated: number, errors: number}`
- `listCandidateFiles_(rootFolderId)` -> `Array<GoogleAppsScript.Drive.File>`
- `extractFileText_(file)` -> `string`
- `readProcessedState_()` / `writeProcessedState_(state)` -> `Object`

- [ ] **Step 1: กำหนด Script Properties** ได้แก่ `LABEL_FOLDER_ID`, `SPREADSHEET_ID`, `LOOKBACK_DAYS` (ค่าเริ่มต้น 7), `LOG_SHEET_NAME` (`Label Sync Log`) และ `OCR_LANGUAGE` (`th`)
- [ ] **Step 2: เขียน `setupLabelSync()`** ให้สร้าง/ตรวจสอบ log sheet, ลบ trigger ของฟังก์ชันเดียวกันที่ซ้ำ และสร้าง installable trigger `runLabelSync` แบบ `everyMinutes(15)`
- [ ] **Step 3: เขียน recursive Drive scan** ให้ลงไปถึง subfolder `270769`, รับเฉพาะ PDF/JPG/JPEG/PNG และใช้ `fileId + modifiedTime` เป็น state key เพื่อให้ไฟล์แก้ไขแล้วถูกประมวลผลใหม่
- [ ] **Step 4: เขียน OCR conversion** ใช้ Drive Advanced Service สร้าง temporary Google Doc จากไฟล์ด้วย OCR ภาษาไทย, อ่าน `DocumentApp` text, แล้วลบ temporary Doc ใน `finally`; ถ้าได้ข้อความว่างให้สถานะ `ocr_empty` และไม่เขียน Sheet
- [ ] **Step 5: เพิ่ม `LockService.getScriptLock()`** โดย lock timeout 30 วินาที; ถ้า lock ไม่ได้ให้จบ run โดยไม่แก้ข้อมูล
- [ ] **Step 6: เขียน README deployment** ระบุการเปิด Drive API/Advanced Drive Service, การตั้ง Script Properties, การ authorize ครั้งแรก, การตั้ง timezone `Asia/Bangkok` และวิธี run แบบ manual เพื่อทดสอบ

---

### Task 3: จับคู่ Sheet O/N และเขียน P แบบ overwrite

**Files:**
- Modify: `apps-script/label-sync/Code.gs`
- Create: `scripts/label-sync/matching.test.js`

**Interfaces:**
- `getTargetDateSheets_(spreadsheet, lookbackDays)` -> `Array<GoogleAppsScript.Spreadsheet.Sheet>`
- `buildOrderIndex_(values, sheetName)` -> `Map<string, Array<{sheetName: string, rowNumber: number, platform: string, orderId: string}>>`
- `buildLabelUpdates_(labels, orderIndex)` -> `Array<{sheetName: string, rowNumber: number, value: string, label: Object}>`
- `applyLabelUpdates_(spreadsheet, updates)` -> `number`

- [ ] **Step 1: เขียน failing matching tests** สำหรับ platform+Order ID, duplicate rows ของ order เดียวกัน, duplicate order ต่าง platform และ unmatched label
- [ ] **Step 2: อ่านเฉพาะ tab วันที่ชื่อ `YYYY-MM-DD`** ภายใน `LOOKBACK_DAYS`; อ่านคอลัมน์ N:P เพื่อใช้ N เป็น platform, O เป็น Order ID และ P เป็นค่าปัจจุบัน
- [ ] **Step 3: normalize key** เป็น `${platform}|${normalizedOrderId}` เมื่อมี platform; ถ้า N ว่างให้ใช้ `orderId` อย่างเดียวเฉพาะกรณีที่มี candidate เดียว
- [ ] **Step 4: อัปเดต P ทุกแถวที่เป็น candidate เดียวกัน** ด้วย `combined` และเขียนทับค่าเดิมตามคำขอ; ใช้ `RangeList.setValue` หรือ grouped `setValues` เพื่อลดจำนวน API calls
- [ ] **Step 5: ป้องกันความขัดแย้ง** ถ้า label เดียวกันมีชื่อ/ที่อยู่ต่างกัน หรือ order มีหลาย platform candidate ให้ไม่เขียนและลงสถานะ `ambiguous`
- [ ] **Step 6: เพิ่ม audit log** ด้วยคอลัมน์ `runAt, fileId, fileName, platform, orderId, status, matchedRows, errorCode`; ห้ามใส่ address เต็มใน log
- [ ] **Step 7: รัน tests**

Run: `node --test scripts/label-sync/labelParser.test.js scripts/label-sync/matching.test.js`

Expected: PASS โดยยืนยันว่า P ถูก overwrite เฉพาะ match ที่ชัดเจน

---

### Task 4: ทดสอบกับ PDF จริงและทำคู่มือเปิดใช้งาน

**Files:**
- Modify: `apps-script/label-sync/README.md`
- Modify: `README.md`
- Modify: `package.json`

- [ ] **Step 1: เพิ่มคำสั่งทดสอบ parser ใน `package.json`** เช่น `test:label-sync` โดยไม่ให้ test ต้องอาศัย Google credential หรือ network
- [ ] **Step 2: รัน parser กับไฟล์จริงใน `C:\Users\Office14\Downloads`** แบบ read-only และตรวจผลลัพธ์ 4 labels ตาม expected IDs ก่อนเชื่อม Sheet
- [ ] **Step 3: ทดสอบ Apps Script แบบ manual run** กับสำเนา Sheet หรือ tab ทดสอบ โดยตรวจว่า P มีรูปแบบ `ชื่อ | ที่อยู่`, O ไม่เปลี่ยน และไฟล์ซ้ำไม่ทำให้เกิดการเขียนซ้ำผิดพลาด
- [ ] **Step 4: ทดสอบ trigger 15 นาทีหนึ่งรอบ** แล้วตรวจ `Label Sync Log`, จำนวนแถวที่อัปเดต และกรณี unmatched/ambiguous
- [ ] **Step 5: อัปเดต README หลัก** ระบุชัดว่าโค้ดปัจจุบันเป็น React/Node และ Apps Script นี้เป็น companion job ไม่ใช่ access token ใน browser
- [ ] **Step 6: รัน verification ทั้งชุดที่เกี่ยวข้อง**

Run: `npm run test:label-sync` และ `npm run test:marketplace`

Expected: PASS; ไม่แก้ไขหรือทำให้ flow scan เดิมเสีย

## Known Decisions Before Implementation

1. ใช้ Apps Script companion เป็น scheduler/Drive/Sheet runtime เพราะ repository ปัจจุบันไม่มี `.gs` และ browser access token ไม่เหมาะกับงาน background
2. ใช้ Drive OCR conversion เป็นเส้นทางหลักก่อน; ถ้าไฟล์บางชนิด OCR ได้ข้อความว่าง จะลง `ocr_empty` และไม่เขียนข้อมูลจนกว่าจะเพิ่ม Vision fallback
3. ใช้ lookback 7 วันเป็นค่าเริ่มต้นเพื่อไม่อ่านทุกแท็บในทุก 15 นาที แต่ปรับได้จาก Script Properties
4. ไม่เพิ่ม UI ใน React รอบแรก; งานนี้ทำเป็น backend sync พร้อม log เพื่อให้ตรวจสอบได้ก่อน
