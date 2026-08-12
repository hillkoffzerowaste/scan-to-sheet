# Sales Quick Desk Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an independently deployable Sales workspace with secure Hillkoff gateway foundations, customer search/create/edit/history, order search/detail, and authoritative order creation.

**Architecture:** Add a URL-addressable Sales feature beneath the existing Vite/React application shell without importing Scan, Marketplace, Google Sheet, or scan-Firestore services. Browser modules call named Vercel Functions; those functions require the existing Google session and use a shared server-only Hillkoff client to call allowlisted `/api/v1` operations.

**Tech Stack:** React 19, Vite 6, Vercel Node Functions, Node test runner, existing CSS token system, Hillkoff `/api/v1`

## Global Constraints

- Read `C:\Users\Office14\DESIGN.md` completely before changing JSX or CSS.
- Preserve all existing Scan, Marketplace, missing-work, and report behavior.
- Sales business data comes exclusively from Hillkoff `/api/v1`; do not use Scan to Sheet Google Sheets or Firestore collections.
- Every Sales gateway requires a valid Scan to Sheet Google session and reads `HILLKOFF_API_KEY` only on the server.
- Do not create a general proxy or allow the browser to choose an upstream URL, host, or arbitrary method.
- Do not duplicate Hillkoff booking, transaction, workflow, notification, or Sheet-sync rules.
- User-visible UI and errors are Thai; stable error codes remain English identifiers.
- Do not cache customer or order data in `localStorage`.
- Every mutation prevents repeated submission and reconciles from Hillkoff before showing success.
- Document-level horizontal overflow must be 0px at 375, 1000, and 1400 pixels in light and dark themes.
- Run `npm run test:marketplace` and `npm run build` before every completion claim.
- Do not stage the user's existing `README.md` modification.

---

## File structure for Phase 1

```text
api/hillkoff/
  _client.js                 shared session, upstream request, timeout, error mapping
  _audit.js                  redacted mutation audit writer
  customers.js              GET search and POST create/edit
  customer-history.js       GET one customer's history
  orders.js                 GET search/detail and POST create

src/features/sales/
  SalesWorkspace.jsx        Sales route/view coordinator
  SalesNavigation.jsx       Sales-local navigation
  salesRoute.js             URL parsing and history helpers
  api/salesApi.js           browser request functions and cancellation
  customers/
    CustomerSearch.jsx
    CustomerEditor.jsx
    CustomerHistory.jsx
    customerForm.js          pure form normalization/validation
  orders/
    OrderSearch.jsx
    OrderDetailDrawer.jsx
    OrderComposer.jsx
    orderForm.js             pure payload/validation/id generation
  shared/
    SalesAsyncState.jsx
    SalesDrawer.jsx
    SalesStatusBadge.jsx

tests/api/
  hillkoff-client.test.js
  hillkoff-customers.test.js
  hillkoff-orders.test.js

src/features/sales/**/*.test.js
```

---

### Task 1: Shared Hillkoff server client and audit foundation

**Files:**
- Create: `api/hillkoff/_client.js`
- Create: `api/hillkoff/_audit.js`
- Modify: `api/hillkoff-me.js`
- Create: `tests/api/hillkoff-client.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `requireHillkoffSession(req) -> Promise<{ sessionId, session }>`
- Produces: `hillkoffRequest({ path, method, query, body, fetchImpl, apiKey, timeoutMs }) -> Promise<{ status, payload, requestId }>`
- Produces: `sendHillkoffResult(res, result) -> void`
- Produces: `recordSalesAudit({ session, action, targetId, outcome, requestId, redis }) -> Promise<void>`
- Consumes: `getSession`, `redisCommand`, `sendError`, and `sendJson` from `api/_auth.js`

- [ ] **Step 1: Write failing client tests**

Create tests that prove the client accepts only relative `/api/v1` paths, sends the server key, applies `AbortSignal.timeout`, returns a request ID, redacts upstream errors, and requires a Google session:

```js
test('rejects a path outside the fixed v1 namespace', async () => {
  await assert.rejects(
    hillkoffRequest({ path: 'https://evil.example/api', apiKey: 'hk_live_test' }),
    { code: 'HILLKOFF_PATH_REJECTED' },
  );
});

test('forwards only the server credential to the fixed origin', async () => {
  const calls = [];
  const result = await hillkoffRequest({
    path: '/api/v1/me',
    apiKey: 'hk_live_test',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ ok: true, data: { clientId: 'c1' } });
    },
  });
  assert.equal(calls[0].url, 'https://repo-rho-livid.vercel.app/api/v1/me');
  assert.equal(calls[0].init.headers['x-api-key'], 'hk_live_test');
  assert.equal(JSON.stringify(result).includes('hk_live_test'), false);
  assert.match(result.requestId, /^[0-9a-f-]{36}$/);
});
```

- [ ] **Step 2: Run the client test and verify RED**

Run: `node --test tests/api/hillkoff-client.test.js`

Expected: FAIL because `api/hillkoff/_client.js` does not exist.

- [ ] **Step 3: Implement the minimal shared client**

Implement a fixed origin, relative-path validation, encoded query building, JSON parsing, timeout, stable mappings for 401/403/409/429/5xx/malformed responses, and the existing Google-session requirement. Preserve upstream `status` and safe `{ ok, data }` success payloads; never return raw non-JSON bodies.

Use this allow condition before constructing the URL:

```js
if (!/^\/api\/v1(?:\/|$)/.test(path)) {
  throw Object.assign(new Error('Rejected Hillkoff path'), {
    code: 'HILLKOFF_PATH_REJECTED',
    status: 500,
  });
}
```

- [ ] **Step 4: Implement redacted audit storage**

Write audit entries to bounded Redis lists keyed by Bangkok date and email hash. Store only:

```js
{
  actorEmailHash,
  action,
  targetId,
  outcome,
  requestId,
  at
}
```

Use `LPUSH`, `LTRIM 0 999`, and an expiry of 90 days. Hash the normalized email with SHA-256; do not store the raw email or business payload.

- [ ] **Step 5: Migrate the health handler**

Make `api/hillkoff-me.js` delegate to `requireHillkoffSession` and `hillkoffRequest({ path: '/api/v1/me' })`. Keep its current public behavior: unauthenticated requests return `NO_GOOGLE_SESSION`; authenticated success returns the safe Hillkoff profile.

- [ ] **Step 6: Add the test to the main suite and verify GREEN**

Append `tests/api/hillkoff-client.test.js` to `test:marketplace`, then run:

```powershell
npm run test:marketplace
npm run build
```

Expected: 0 failed tests and Vite build exit code 0.

- [ ] **Step 7: Commit the gateway foundation**

```powershell
git add api/hillkoff/_client.js api/hillkoff/_audit.js api/hillkoff-me.js tests/api/hillkoff-client.test.js package.json
git commit -m "feat: centralize authenticated Hillkoff requests" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Allowlisted customer gateways

**Files:**
- Create: `api/hillkoff/customers.js`
- Create: `api/hillkoff/customer-history.js`
- Create: `tests/api/hillkoff-customers.test.js`
- Modify: `package.json`

**Interfaces:**
- `GET /api/hillkoff/customers?q=<3+ chars>` -> Hillkoff `GET /api/v1/customers?q=`
- `POST /api/hillkoff/customers` with `{ customer }` -> Hillkoff `POST /api/v1/customers`
- `GET /api/hillkoff/customer-history?customerId=<id>` -> Hillkoff history endpoint
- Consumes: Task 1 `requireHillkoffSession`, `hillkoffRequest`, `sendHillkoffResult`, `recordSalesAudit`

- [ ] **Step 1: Write failing route tests**

Test exact query and payload allowlists with dependency-injected handler factories. Required cases:

```js
test('customer search rejects fewer than three normalized characters', async () => {
  const response = await invokeCustomerHandler({ method: 'GET', query: { q: 'ab' } });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'CUSTOMER_QUERY_TOO_SHORT');
});

test('customer write drops fields outside the customer contract', async () => {
  const calls = [];
  await invokeCustomerHandler({
    method: 'POST',
    body: { customer: { id: 'cus-1', name: 'ร้าน A', phone: '0812345678', admin: true } },
    hillkoff: async (input) => { calls.push(input); return { status: 200, payload: { ok: true, data: { id: 'cus-1' } } }; },
  });
  assert.deepEqual(calls[0].body.customer, { id: 'cus-1', name: 'ร้าน A', phone: '0812345678', contact: '', zone: '', address: '', mapUrl: '', note: '' });
});
```

Also test missing session, unsupported method, invalid ID, map URL protocol rejection, 409 duplicate passthrough, and audit success/failure calls.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/api/hillkoff-customers.test.js`

Expected: FAIL because the customer handlers do not exist.

- [ ] **Step 3: Implement customer validation and handlers**

Allow customer fields only: `id`, `name`, `contact`, `phone`, `zone`, `address`, `mapUrl`, `note`. Enforce the upstream ID pattern `/^[A-Za-z0-9._-]{1,120}$/`, safe HTTP(S) map URLs, and the exact string length ceilings documented by Hillkoff. Do not implement duplicate detection locally; preserve upstream 409 and safe `data.duplicateId`/`duplicateName` fields.

- [ ] **Step 4: Implement history gateway**

Allow only `customerId`; reject slash-containing or pattern-invalid values before upstream. Preserve `{ customer, orders, count }` success data.

- [ ] **Step 5: Verify full suite and commit**

Run `npm run test:marketplace` and `npm run build`, then:

```powershell
git add api/hillkoff/customers.js api/hillkoff/customer-history.js tests/api/hillkoff-customers.test.js package.json
git commit -m "feat: expose bounded Hillkoff customer operations" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Allowlisted order search and creation gateway

**Files:**
- Create: `api/hillkoff/orders.js`
- Create: `tests/api/hillkoff-orders.test.js`
- Modify: `package.json`

**Interfaces:**
- `GET /api/hillkoff/orders?q=<query>` -> upstream text search
- `GET /api/hillkoff/orders?id=<orderId>` -> upstream order plus activity
- `POST /api/hillkoff/orders` with `{ order }` -> upstream create
- Consumes: Task 1 shared client/audit functions

- [ ] **Step 1: Write failing mapping tests**

Test search requires exactly one of `q` or `id`, query length is at least 2, ID matches the upstream pattern, and POST keeps only:

```js
const ORDER_FIELDS = [
  'id', 'customerId', 'deliveryMethod', 'workflowType', 'serviceDate',
  'window', 'boxes', 'packageUnit', 'paymentType', 'cod',
  'bookingNumber', 'bookingNumbers', 'salesNote', 'shippingCarrier',
  'chiangmaiRoundCode',
];
```

Include a literal payload assertion proving a browser-supplied `driverId`, `status`, `queueStatus`, `createdByUid`, or arbitrary nested object does not reach upstream.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/api/hillkoff-orders.test.js`

Expected: FAIL because `api/hillkoff/orders.js` does not exist.

- [ ] **Step 3: Implement order GET gateway**

Allow `q` or `id`, never both. URL-encode through the shared client's `query` object. Preserve safe upstream order/activity results without caching.

- [ ] **Step 4: Implement order POST validation**

Validate ID/customer ID patterns, service date `YYYY-MM-DD`, delivery methods `company_driver|grab_pickup|customer_pickup|outstation`, package units `box|bag`, boxes integer 0–10000, COD 0–1,000,000,000, maximum 20 booking numbers, and string ceilings matching upstream. Treat local checks as fast feedback; upstream remains authoritative.

- [ ] **Step 5: Protect mutations and audit outcomes**

Do not retry POST automatically. Record `order_create` with target order ID and `success|conflict|rejected|failed`. Preserve upstream `alreadyExists: true` as success and preserve 409 as conflict.

- [ ] **Step 6: Verify and commit**

Run `npm run test:marketplace` and `npm run build`, then:

```powershell
git add api/hillkoff/orders.js tests/api/hillkoff-orders.test.js package.json
git commit -m "feat: add safe Hillkoff order operations" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Sales navigation and independent workspace shell

**Files:**
- Create: `src/features/sales/salesRoute.js`
- Create: `src/features/sales/salesRoute.test.js`
- Create: `src/features/sales/SalesNavigation.jsx`
- Create: `src/features/sales/SalesWorkspace.jsx`
- Create: `src/features/sales/shared/SalesAsyncState.jsx`
- Create: `src/features/sales/shared/SalesDrawer.jsx`
- Modify: `src/App.jsx`
- Modify: `src/styles.css`
- Modify: `package.json`

**Interfaces:**
- `parseSalesRoute(location) -> { workspace: 'overview'|'customers'|'orders', query: string, selectedId: string } | null`
- `salesUrl(route) -> string`
- `SalesWorkspace({ route, navigate, sessionProfile })`
- Consumes: existing `isSignedIn` and Google profile state only; no Scan service/state props

- [ ] **Step 1: Read the design source and write route tests**

Read `C:\Users\Office14\DESIGN.md` completely. Then test URL behavior:

```js
assert.deepEqual(parseSalesRoute(new URL('https://app.test/?workspace=sales&view=customers&q=abc')), {
  workspace: 'customers', query: 'abc', selectedId: '',
});
assert.equal(salesUrl({ workspace: 'orders', selectedId: 'ORD-1' }), '/?workspace=sales&view=orders&id=ORD-1');
```

Also test invalid views fall back to `overview` and non-Sales URLs return `null`.

- [ ] **Step 2: Run route tests and verify RED**

Run: `node --test src/features/sales/salesRoute.test.js`

Expected: FAIL because `salesRoute.js` does not exist.

- [ ] **Step 3: Implement route helpers and browser navigation**

Use `history.pushState` and a `popstate` listener. Do not add a routing dependency. Preserve existing URLs when the user stays in Scan modules.

- [ ] **Step 4: Add the Sales entry without coupling state**

Add one Sales navigation button to the existing tab bar. When Sales is active, render only `SalesWorkspace` in the workspace region and stop camera work using the same cleanup path as other tab transitions. Do not pass couriers, scan rows, Marketplace state, Google Sheet config, or scan mutation callbacks into Sales.

- [ ] **Step 5: Build the responsive Sales shell**

Create semantic navigation and main landmarks, a mobile slide drawer, visible skip target, and focus restoration when drawers close. Use existing CSS variables only; no new hardcoded colors. Add loading/empty/error primitives with Thai copy and stable status semantics.

- [ ] **Step 6: Verify responsive shell**

Run unit suite and build. Start the preview using the project-approved preview tool, then measure:

```js
document.documentElement.scrollWidth - document.documentElement.clientWidth
```

Expected `0` at 375, 1000, and 1400 in light and dark modes. Confirm keyboard focus enters and exits the Sales drawer correctly.

- [ ] **Step 7: Commit shell**

```powershell
git add src/features/sales src/App.jsx src/styles.css package.json
git commit -m "feat: add an independent Sales workspace shell" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Browser Sales API and customer workspace

**Files:**
- Create: `src/features/sales/api/salesApi.js`
- Create: `src/features/sales/api/salesApi.test.js`
- Create: `src/features/sales/customers/customerForm.js`
- Create: `src/features/sales/customers/customerForm.test.js`
- Create: `src/features/sales/customers/CustomerSearch.jsx`
- Create: `src/features/sales/customers/CustomerEditor.jsx`
- Create: `src/features/sales/customers/CustomerHistory.jsx`
- Modify: `src/features/sales/SalesWorkspace.jsx`
- Modify: `src/styles.css`
- Modify: `package.json`

**Interfaces:**
- `salesApi.searchCustomers(query, { signal })`
- `salesApi.saveCustomer(customer, { signal })`
- `salesApi.getCustomerHistory(customerId, { signal })`
- `normalizeCustomerForm(input) -> allowed customer payload`
- `validateCustomerForm(input) -> { valid, errors }`

- [ ] **Step 1: Write failing browser API and form tests**

Prove GET query encoding, `credentials: 'same-origin'`, safe JSON errors with `code/status/requestId`, AbortError propagation, field normalization, minimum name, ID pattern, and HTTP(S)-only map URL.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node --test src/features/sales/api/salesApi.test.js src/features/sales/customers/customerForm.test.js
```

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement the browser client and form model**

Use a shared `salesFetch` that never includes the Hillkoff key. It may retry one idempotent GET after a network failure; it must never retry POST automatically.

- [ ] **Step 4: Build customer search**

Use a 300ms debounce, abort the previous request, require 3 characters, preserve query in the URL, and render explicit loading/empty/error/result states. Each result exposes View history, Edit, and Select for new order.

- [ ] **Step 5: Build create/edit and history drawers**

Keep close matches visible before Create. On 409, highlight the returned duplicate instead of clearing the form. Preserve form content on timeout/5xx. After save, refetch the selected customer before announcing success.

- [ ] **Step 6: Verify and commit**

Run `npm run test:marketplace`, `npm run build`, and browser keyboard/mobile checks, then:

```powershell
git add src/features/sales package.json src/styles.css
git commit -m "feat: add the Sales customer workspace" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Order search, detail, and composer

**Files:**
- Create: `src/features/sales/orders/orderForm.js`
- Create: `src/features/sales/orders/orderForm.test.js`
- Create: `src/features/sales/orders/OrderSearch.jsx`
- Create: `src/features/sales/orders/OrderDetailDrawer.jsx`
- Create: `src/features/sales/orders/OrderComposer.jsx`
- Modify: `src/features/sales/api/salesApi.js`
- Modify: `src/features/sales/api/salesApi.test.js`
- Modify: `src/features/sales/SalesWorkspace.jsx`
- Modify: `src/styles.css`
- Modify: `package.json`

**Interfaces:**
- `salesApi.searchOrders(query, { signal })`
- `salesApi.getOrder(id, { signal })`
- `salesApi.createOrder(order, { signal })`
- `createOrderId({ now, random }) -> /^[A-Za-z0-9._-]{1,120}$/`
- `normalizeOrderForm(form, customer) -> upstream order payload`
- `validateOrderForm(form, customer) -> { valid, errors }`

- [ ] **Step 1: Write failing order model tests**

Cover Bangkok service-date defaults, deterministic injected ID generation, package/COD boundaries, booking-number list dedupe/max 20, conditional outstation carrier, conditional Chiang Mai round, and omission of privileged fields.

```js
const payload = normalizeOrderForm({
  id: 'ORD-1', deliveryMethod: 'outstation', boxes: '3', cod: '1200',
  bookingNumbers: ['BK-1', 'BK-1'], shippingCarrier: 'Kerry', status: 'ส่งสำเร็จ',
}, { id: 'cus-1' });
assert.deepEqual(payload.bookingNumbers, ['BK-1']);
assert.equal(payload.status, undefined);
assert.equal(payload.customerId, 'cus-1');
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test src/features/sales/orders/orderForm.test.js`

Expected: FAIL because `orderForm.js` does not exist.

- [ ] **Step 3: Implement order model and API methods**

Keep pure normalization separate from React. POST is single-attempt and accepts an AbortSignal only for explicit user cancellation before the request completes; after submission begins, the UI must reconcile by order ID before allowing another create attempt.

- [ ] **Step 4: Build search and detail drawer**

Search by the existing Hillkoff terms and display booking/customer/package/COD/service/preparation data. Detail-by-ID renders activity chronologically. The drawer has semantic headings, close button, focus trap/restoration, and direct URL restoration.

- [ ] **Step 5: Build the order composer**

Use the selected customer from Task 5 or open embedded customer search. Render two columns plus a continuously visible review summary on desktop and one column on mobile. Progressively reveal delivery-specific fields. Keep the final Create button disabled only for explicit validation reasons shown beside the relevant fields.

- [ ] **Step 6: Implement authoritative submission states**

States are `editing -> submitting -> reconciling -> succeeded|conflict|failed`. On `alreadyExists`, load that order and show success. On 409, retain every field and show the conflict. On timeout/unknown failure, query the submitted ID before offering Retry so a successful upstream create is not duplicated.

- [ ] **Step 7: Full Phase 1 verification**

Run:

```powershell
npm run test:marketplace
npm run build
```

Then browser-test signed-out gateway 401, signed-in customer search/save/history, order search/detail/create, duplicate click protection, booking conflict retention, reload/back-forward restoration, light/dark contrast, keyboard flow, and overflow at 375/1000/1400.

- [ ] **Step 8: Commit Phase 1 order workspace**

```powershell
git add src/features/sales package.json src/styles.css
git commit -m "feat: complete Sales order search and creation" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Phase 1 release gate

- [ ] Confirm `git diff --check` passes and only Phase 1 files are staged.
- [ ] Confirm the user's pre-existing `README.md` edit remains unstaged.
- [ ] Confirm `HILLKOFF_API_KEY` exists for Preview and Production by name only; never print its value.
- [ ] Run `npm run test:marketplace` and record pass/fail/skip counts.
- [ ] Run `npm run build` and record warnings separately from failures.
- [ ] Deploy Preview first and exercise the signed-in create flow with a designated test customer/order ID.
- [ ] Verify the created order is visible in both Sales Quick Desk and the original Hillkoff UI.
- [ ] Verify audit records identify the Google actor hash, action, target, outcome, and request ID without personal payloads.
- [ ] Production promotion or push to `main` requires the user's explicit instruction under this project's Git rules.

## Deferred plans

After Phase 1 production verification, write separate plans from the approved design for:

1. Phase 2: operational overview, today's work, preparation readiness, dispatch dashboard, and queue action.
2. Phase 3: outstation workspace and Chiang Mai round grouping/assignment.
3. Phase 4: end-to-end hardening, observability, audit review, and API-scope reduction.
