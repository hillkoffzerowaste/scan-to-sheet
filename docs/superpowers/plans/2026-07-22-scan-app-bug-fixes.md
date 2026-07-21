# Scan App Bug Fixes Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with TDD and verify every gate before completion.

**Goal:** Prevent scan-event recovery data loss, remove Firestore result truncation, stabilize E2E tab coverage, and reduce the initial JavaScript payload.

**Architecture:** Keep the existing Firebase/Google Sheets flows, but extract pure recovery and pagination helpers so the critical behavior is unit-testable. Use stable `data-testid` hooks only for E2E controls and lazy-load the XLSX parser at upload time.

**Tech Stack:** React 19, Vite, Firebase Firestore, Node test runner, Playwright.

## Global Constraints

- Preserve existing Google Sheet and Firestore schemas and scan behavior.
- Do not delete or weaken existing tests.
- Do not include user-generated reports, logs, caches, or environment files in the change.
- Run service tests, E2E tests, and production build before completion.

### Task 1: Recovery data integrity

**Files:**
- Create: `src/services/orderRecovery.js`
- Create: `src/services/orderRecovery.test.js`
- Modify: `src/services/firebaseScans.js`

Add a pure helper that turns legacy `scanEvents` into a complete order candidate and builds a recovery patch preserving code, dates, courier, admin/packer scans, and matched status. Test the admin-first recovery case before wiring it into Firestore transactions.

### Task 2: Firestore pagination

**Files:**
- Create: `src/services/firestorePagination.js`
- Create: `src/services/firestorePagination.test.js`
- Modify: `src/services/firebaseScans.js`

Add a reusable page collector, then use `startAfter` pagination for search, reports, and missing-order checks instead of fixed 1,000/2,000 row caps. Test that multiple pages return every item.

### Task 3: Stable E2E selectors

**Files:**
- Modify: `src/App.jsx`
- Modify: `tests/e2e/scan-app.spec.js`

Add `data-testid="packer-tab"` and `data-testid="drive-tab"`, then update tab tests to use those stable hooks. Keep visible labels independent from test selectors.

### Task 4: Bundle loading

**Files:**
- Modify: `src/App.jsx`

Load the XLSX parser only when a marketplace file is uploaded, preserving upload behavior while reducing the initial bundle.

### Task 5: Verification

Run `npm.cmd run test:marketplace`, the focused new tests, `npm.cmd run test:e2e`, and `npm.cmd run build`; review `git diff` and `git status` for scope and generated artifacts.
