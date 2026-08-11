# Compact Scan Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปลี่ยน scan popup ให้เป็น responsive compact modal ที่ไม่เต็มจอและแสดงสถานะสแกนล่าสุดภายใน popup

**Architecture:** คง state และ flow การสแกนเดิมไว้ แล้วเพิ่มโครง dialog header กับ status view ที่อ่านจาก `status` ชุดเดียวกับหน้าหลัก CSS ใช้ centered modal บนจอกว้างและ inset bottom sheet บนมือถือ พร้อม body scroll lock และ Escape handler ใน `App.jsx`

**Tech Stack:** React 19, JavaScript ES modules, CSS custom properties, Node.js test runner, Playwright browser verification

## Global Constraints

- ใช้กับ Packer และ Drive โดยไม่เปลี่ยน scan queue, Firestore, Google Sheet หรือ duplicate logic
- popup card ต้องทึบและสีใหม่ต้องมาจาก CSS variable เดิมเท่านั้น
- ข้อความ UI เป็นภาษาไทยและ status ภายใน popup ต้องใช้ state `status` เดิม
- horizontal overflow ต้องเป็น 0px ที่ 375, 768, 1000, 1280 และ 1400px
- ต้องรักษา `README.md` ที่แก้ค้างไว้และห้ามรวมใน commit

---

### Task 1: Dialog behavior and status presentation

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/services/scanPopup.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing `scanPopupOpen`, `status`, `scanMethod`, `stopCamera`, `focusScanInput`
- Produces: accessible dialog markup and `getScanPopupStatusMeta(statusType)` presentation mapping

- [ ] **Step 1: Write failing tests**

Test that `getScanPopupStatusMeta` maps success, duplicate, warning, error and ignored to stable icon/tone metadata, and that unknown values fall back safely.

- [ ] **Step 2: Run focused test and confirm failure**

Run `node --test src/services/scanPopup.test.js`; expect module/function-not-found failure.

- [ ] **Step 3: Implement status mapping and dialog behavior**

Add a focused pure module for status metadata. In `App.jsx`, add dialog semantics, header close button, shared status content, Escape listener and body overflow restoration. Keep overlay and footer close actions stopping only the camera.

- [ ] **Step 4: Run focused test**

Run `node --test src/services/scanPopup.test.js`; expect all tests to pass.

### Task 2: Responsive compact modal styling

**Files:**
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `.scan-popup-overlay`, `.scan-popup-sheet`, `.scan-popup-header`, `.scan-popup-feedback`

- [ ] **Step 1: Implement desktop modal layout**

Center a maximum 720px card with maximum 80dvh/760px height, opaque surface, existing border/shadow tokens and internal scrolling.

- [ ] **Step 2: Implement mobile inset sheet**

At the existing mobile breakpoint, place the card 12px from the viewport edges, cap at 82dvh, keep all corners rounded and preserve 44px touch targets.

- [ ] **Step 3: Compact camera and controls**

Limit popup camera stage to a 4:3 area, align issue controls in a two-column row where space permits, and retain a single-column fallback without horizontal overflow.

### Task 3: Verification, commit and release

**Files:**
- Review task-related changes only

**Interfaces:**
- Produces: verified commit on `codex/compact-scan-popup`, fast-forwarded and pushed `main`

- [ ] **Step 1: Run required verification**

Run `npm.cmd run test:marketplace` and `npm.cmd run build`; both must exit 0.

- [ ] **Step 2: Browser verification**

Verify light/dark rendering, dialog size, feedback rendering, Escape/overlay/close actions and overflow at 375, 768, 1000, 1280 and 1400px.

- [ ] **Step 3: Commit scoped files**

Stage only App, styles, status module/test, package script, spec and plan. Commit with the required co-author trailer; do not include `README.md`.

- [ ] **Step 4: Release to main**

Fetch origin, confirm `main` has not diverged, fast-forward the feature commit into `main`, rerun required tests/build, and push `origin main` as explicitly requested.
