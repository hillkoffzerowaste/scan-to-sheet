# Sales Quick Desk Phases 2–4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the independently deployable Phase 1 Sales workspace with today's operations, queueing, outstation work, Chiang Mai rounds, and production-grade verification.

**Architecture:** Continue the Phase 1 named-gateway pattern: React domain modules call allowlisted Scan to Sheet Vercel Functions, which require the Google session and call fixed Hillkoff `/api/v1` endpoints. Keep presentation-derived readiness separate from authoritative Hillkoff workflow validation and reconcile every mutation from upstream.

**Tech Stack:** React 19, Vite 6, Vercel Node Functions, Node test runner, existing CSS tokens, Hillkoff `/api/v1`

## Global Constraints

- All constraints from `2026-08-12-sales-quick-desk-phase-1.md` remain in force.
- Do not stage or modify the user's existing `README.md` change.
- Phase 2–4 modules must import only Sales shared modules and browser APIs, never Scan/Marketplace/Sheet services.
- Production mutations require explicit user authorization; preview verification uses designated test records only.

---

### Task 1: Dispatch dashboard and workflow gateway

**Files:**
- Create: `api/hillkoff/dispatch-dashboard.js`
- Create: `api/hillkoff/workflow.js`
- Create: `tests/api/hillkoff-dispatch.test.js`
- Modify: `package.json`

**Interfaces:**
- `POST /api/hillkoff/dispatch-dashboard` accepts `{ selectedDate }` and calls `/api/v1/orders/dispatch-dashboard`.
- `PATCH /api/hillkoff/workflow` accepts only `{ orderId, action: 'queue', note? }` in this release.

- [ ] Write failing tests proving date validation, queue-only action allowlisting, removal of extra payload fields, no automatic mutation retry, and audit outcomes.
- [ ] Run `node --test tests/api/hillkoff-dispatch.test.js` and confirm failure because handlers do not exist.
- [ ] Implement both handlers using the Phase 1 client and audit contracts.
- [ ] Add tests to `test:marketplace`; run the full suite and build.
- [ ] Commit only the gateway/test files.

### Task 2: Operational overview and queue readiness

**Files:**
- Create: `src/features/sales/dashboard/SalesDashboard.jsx`
- Create: `src/features/sales/dashboard/dashboardModel.js`
- Create: `src/features/sales/dashboard/dashboardModel.test.js`
- Create: `src/features/sales/dispatch/DispatchQueue.jsx`
- Create: `src/features/sales/dispatch/queueReadiness.js`
- Create: `src/features/sales/dispatch/queueReadiness.test.js`
- Modify: `src/features/sales/api/salesApi.js`
- Modify: `src/features/sales/SalesWorkspace.jsx`
- Modify: `src/styles.css`

- [ ] Write failing pure tests for compact metric derivation and explicit readiness reasons for store, pack, rework, delivery method, and already-queued states.
- [ ] Run the two focused test files and confirm RED.
- [ ] Implement pure models, then dashboard/queue components with loading, empty, stale, error, and retry states.
- [ ] Add single-attempt queue mutation; keep the row pending, then reload dashboard and detail before success.
- [ ] Verify responsive layout and commit Phase 2 UI.

### Task 3: Outstation view

**Files:**
- Create: `src/features/sales/outstation/OutstationOrders.jsx`
- Create: `src/features/sales/outstation/outstationModel.js`
- Create: `src/features/sales/outstation/outstationModel.test.js`
- Modify: `src/features/sales/SalesWorkspace.jsx`
- Modify: `src/styles.css`

- [ ] Write failing tests for outstation-only filtering, carrier/tracking/data-completeness grouping, and chronological ordering.
- [ ] Confirm RED, implement the pure model, then build the view using Phase 1 order search/detail only.
- [ ] Show unsupported upstream actions as absent, not disabled placeholders.
- [ ] Run full tests/build/browser checks and commit.

### Task 4: Chiang Mai round gateway and workspace

**Files:**
- Create: `api/hillkoff/chiangmai-rounds.js`
- Create: `tests/api/hillkoff-chiangmai.test.js`
- Create: `src/features/sales/chiangmai/ChiangmaiRounds.jsx`
- Create: `src/features/sales/chiangmai/chiangmaiModel.js`
- Create: `src/features/sales/chiangmai/chiangmaiModel.test.js`
- Modify: `src/features/sales/api/salesApi.js`
- Modify: `src/features/sales/SalesWorkspace.jsx`
- Modify: `src/styles.css`
- Modify: `package.json`

- [ ] Write failing gateway tests for PATCH-only, order ID/round allowlists, and stripped extra fields.
- [ ] Write failing model tests for grouped assigned/unassigned orders and deterministic counts.
- [ ] Confirm RED for both layers.
- [ ] Implement the named gateway and grouped expandable workspace.
- [ ] Require confirmation when changing an existing round, prevent repeat clicks, and reconcile affected groups.
- [ ] Run full verification and commit.

### Task 5: Phase 4 hardening

**Files:**
- Create/modify: `tests/e2e/sales-quick-desk.spec.js`
- Modify only when evidence requires: Sales feature/gateway files
- Create: `docs/uat/2026-08-12-sales-quick-desk-checklist.md`

- [ ] Add E2E coverage for signed-out protection, URL restoration, search cancellation, drawer focus, repeated-click prevention, and safe error display. Use mocked named gateways for deterministic browser tests; do not mock internal React components.
- [ ] Run `npm run test:marketplace`, `npm run build`, and targeted Playwright Sales tests.
- [ ] Measure document overflow at 375/1000/1400 in light/dark, inspect contrast from rendered DOM, and run accessibility checks for the Sales workspace.
- [ ] Deploy a preview, verify named production-function inventory excludes test files, and test Google-session protection.
- [ ] With an authorized designated test record, verify customer/order/queue/round cross-visibility in the original Hillkoff UI; do not create or mutate production records without that exact authorization.
- [ ] Review Vercel error logs, request IDs, and redacted audit records.
- [ ] Record completed/skipped UAT checks and remaining risks in the checklist.
- [ ] Run final diff/status/secret/generated-file checks and commit hardening artifacts.

## Completion gate

- [ ] Every phase is independently functional and existing non-Sales workflows remain unchanged.
- [ ] Full unit suite and production build pass from the final tree.
- [ ] Targeted Sales E2E and visual/accessibility checks pass or limitations are precisely disclosed.
- [ ] `README.md` remains unstaged.
- [ ] Push/deploy production only under explicit user authorization.
