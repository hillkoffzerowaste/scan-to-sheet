# Continuous Barcode Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้หน้า Packer และ Drive รับบาร์โค้ดจากเครื่องยิงต่อเนื่องได้ทันทีโดยเลขไม่ต่อกันและไม่ต้องคลิกช่องรับเลขซ้ำ ขณะที่ระบบบันทึกแต่ละรายการตามลำดับอย่างปลอดภัย

**Architecture:** แยกกลไกคิว FIFO แบบ pure ออกจาก `App.jsx` เพื่อทดสอบการรับงาน การกันรายการซ้ำที่ยังค้าง และการเดินคิวหลัง error ได้โดยตรง `App.jsx` จะ snapshot บริบทของแต่ละสแกน ล้าง input และคืน focus ทันที แล้วให้ worker เพียงตัวเดียวเรียกเส้นทางบันทึก Packer/Drive เดิมตามลำดับ

**Tech Stack:** React 19, Vite 6, JavaScript ES modules, Node.js test runner

## Global Constraints

- ใช้คิวเดียวกับทั้งหน้า Packer และ Drive และประมวลผลทีละรายการ
- เครื่องยิงส่ง Enter เป็นตัวจบเลข; ห้ามแยกเลขจาก timing ของ keypress
- ห้าม disable ช่องสแกนระหว่างมีงานบันทึก และต้องคืน focus อัตโนมัติโดยไม่แย่ง focus จาก control อื่นขณะผู้ใช้กำลังตั้งค่า
- snapshot `activeTab`, `courier`, `packer`, `remark`, และตัวเลือก validation ลงในงานแต่ละรายการ
- รายการหนึ่งล้มเหลวต้องไม่หยุดคิว และคิวรับได้ไม่เกิน 100 รายการรวมงานที่กำลังทำ
- ห้ามแก้ schema, Firestore rules หรือเส้นทาง Google Sheet lock
- ข้อความ UI เป็นภาษาไทย และสีใหม่ (ถ้ามี) ต้องใช้ CSS variable เดิมเท่านั้น

---

### Task 1: Pure FIFO scan queue

**Files:**
- Create: `src/services/scanQueue.js`
- Create: `src/services/scanQueue.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `createScanQueue({ process, onStateChange, maxSize = 100 })`
- Queue methods: `enqueue(job)`, `getSnapshot()`, `dispose()`
- A job contains `{ id, code, context }`; `enqueue` returns `{ accepted, reason, job }`

- [ ] **Step 1: Write failing tests**

Cover FIFO order, immediate acceptance while processing, rejection of a duplicate `code` already queued/in-flight, capacity 100, and continuation after `process` rejects.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test src/services/scanQueue.test.js`
Expected: FAIL because `scanQueue.js` does not exist.

- [ ] **Step 3: Implement the minimal queue**

Keep queue state private, allow only one drain loop, remove the normalized code from the pending set in `finally`, catch each job error into its result state, notify subscribers with immutable snapshots, and continue draining.

- [ ] **Step 4: Add the focused test to `test:marketplace` and verify**

Run: `node --test src/services/scanQueue.test.js`
Expected: PASS.

### Task 2: Connect scanner input and background worker

**Files:**
- Modify: `src/App.jsx`
- Test: `src/services/scanQueue.test.js`

**Interfaces:**
- Consumes: `createScanQueue`
- Produces UI state `{ pending, processing, completed, failed, lastResult }`

- [ ] **Step 1: Create a stable queue instance owned by `App`**

Create the queue once, keep current save handlers in refs so the worker sees current functions without recreating the queue, and dispose it on unmount.

- [ ] **Step 2: Change manual submit into capture-only behavior**

On Enter, copy `scanValue`, clear it synchronously, focus the input on the next animation frame, validate required UI context, snapshot role/courier/packer/remark/options, and enqueue. Do not await the backend commit from the submit handler.

- [ ] **Step 3: Make save handlers consume snapshot context**

Allow `saveScannedCode` and `saveAdminScannedCode` to receive the captured context so a later courier/Packer/remark change cannot alter queued work. Preserve the existing Firestore-primary and Sheet fallback behavior.

- [ ] **Step 4: Separate global busy state from queue processing**

Do not set the global `busy` flag for queued manual scans. Keep it for login, imports, camera operations, and other blocking actions. Ensure a completed job never clears another operation's busy state.

- [ ] **Step 5: Restore focus safely**

Focus on entering manual mode, switching Packer/Drive, closing the scan popup, and after each accepted/rejected Enter. Only focus when the active element is `body`, the scan input, or a scan-submit button; never steal focus from `select`, checkbox, or issue buttons.

### Task 3: Simplify controls and expose queue status

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/styles.css` only if existing classes cannot express the status

**Interfaces:**
- Consumes queue snapshot from Task 2

- [ ] **Step 1: Remove single/continuous controls for both roles**

Manual barcode scanning is always continuous. Preserve camera behavior unless its existing single-mode state is required; if no longer reachable, remove dead state and branches.

- [ ] **Step 2: Keep scan input enabled while queue works**

Disable it only when signed out or Packer is not selected. The submit button may show queue activity but must not disable input capture.

- [ ] **Step 3: Add compact Thai queue feedback**

Show current saving code and pending count near the input. Report duplicate-in-queue and queue-full immediately. Keep per-item backend success/error reporting from the existing save functions.

### Task 4: Verification and release gate

**Files:**
- Review all task-related diffs only

- [ ] **Step 1: Run required automated verification**

Run: `npm run test:marketplace`
Expected: all tests pass.

Run: `npm run build`
Expected: production build succeeds.

- [ ] **Step 2: Inspect the final diff and working tree**

Confirm `README.md` remains untouched by this task and no logs, reports, environment files, or generated artifacts are included.

- [ ] **Step 3: Verify the rendered UI**

Check manual scanner capture and zero horizontal overflow at 375, 1000, and 1400px. Confirm focus restoration, rapid consecutive Enter submissions, FIFO display, duplicate feedback, and continued processing after a simulated failure.

- [ ] **Step 4: Commit without pushing**

Stage task files only and commit with an English message describing the continuous scanner behavior and the prior blocking cause. Include the required co-author trailer. Do not push because project instructions require an explicit push request.
