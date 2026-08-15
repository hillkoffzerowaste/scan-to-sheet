# ระบบส่งของ link-only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the embedded Sales Quick Desk with a safe new-tab link to the Hillkoff delivery system and remove every Scan to Sheet API-v1 integration artifact.

**Architecture:** The Scan to Sheet shell retains its scan, Drive, report, staff and external-tool behavior. The former sales tab becomes a static sidebar anchor pointing directly to the delivery application, so no shared component, gateway endpoint, API key, or server-side proxy remains in this repository.

**Tech Stack:** React 19, Vite, Playwright, Node test runner, npm.

## Global Constraints

- Delivery target is exactly `https://repo-rho-livid.vercel.app/`.
- The link opens a new tab with `target="_blank"` and `rel="noopener noreferrer"`.
- Do not modify Scan to Sheet scan, Drive, report, staff, Firebase, Google Sheets, or uncommitted `packingVideo` files.
- Remove code-only Hillkoff configuration; do not mutate Vercel environment variables.
- Preserve historical documents under `docs/superpowers/`.

---

## File structure

| Path | Responsibility after this change |
| --- | --- |
| `src/App.jsx` | Renders the sidebar link and no longer imports or mounts a sales workspace. |
| `tests/e2e/scan-app.spec.js` | Verifies the delivery-system link’s label, destination, security attributes, and mobile layout. |
| `package.json`, `package-lock.json`, `.npmrc` | Contain no private shared-workspace dependency or GitHub Packages registry configuration. |
| `README.md`, `.env.example` | Contain no Scan to Sheet `HILLKOFF_API_KEY` setup instruction. |
| `api/hillkoff.js`, `lib/hillkoffGateway.js`, `src/features/sales/**`, `tests/api/hillkoff-*.test.js`, `tests/e2e/sales-quick-desk.spec.js` | Deleted because they only implement the retired embedded integration. |

### Task 1: Replace the embedded workspace with the delivery-system link

**Files:**
- Modify: `src/App.jsx:1-35, 2947-2956, 4052`
- Modify: `src/styles.css:2945, 2986-3055`
- Modify: `tests/e2e/scan-app.spec.js:121-145`
- Delete: `tests/e2e/sales-quick-desk.spec.js`

**Interfaces:**
- Consumes: existing `.tab-bar` and `.tab-button` styling in `src/styles.css`.
- Produces: `<a data-testid="delivery-system-link" ...>` with no `activeTab === 'sales'` state or sales pane.

- [ ] **Step 1: Write the failing external-link test**

Add this test in the existing `Scan to Sheet — External tools` describe block:

```js
test('opens the delivery system from the sidebar in a new tab', async ({ page }) => {
  await page.goto(BASE_URL);
  const deliveryLink = page.getByTestId('delivery-system-link');
  await expect(deliveryLink).toHaveAccessibleName('ระบบส่งของ');
  await expect(deliveryLink).toHaveAttribute('href', 'https://repo-rho-livid.vercel.app/');
  await expect(deliveryLink).toHaveAttribute('target', '_blank');
  await expect(deliveryLink).toHaveAttribute('rel', /noopener/);
  await expect(deliveryLink).toHaveAttribute('rel', /noreferrer/);
  await expect(page.getByText('Sales Quick Desk')).toHaveCount(0);
});
```

- [ ] **Step 2: Run the test to verify it fails for the intended reason**

Run: `npx playwright test tests/e2e/scan-app.spec.js --project=chromium --grep "delivery system" --workers=1`

Expected: FAIL because `delivery-system-link` does not exist while the current Sales Quick Desk button still renders.

- [ ] **Step 3: Implement the smallest UI change**

In `src/App.jsx`, remove the `SalesWorkspace` import and `BriefcaseBusiness` import. Replace the active sales `<button>` with:

```jsx
<a
  data-testid="delivery-system-link"
  className="tab-button"
  href="https://repo-rho-livid.vercel.app/"
  target="_blank"
  rel="noopener noreferrer"
>
  <Truck size={18} />
  <span>ระบบส่งของ</span>
</a>
```

Remove `{activeTab === 'sales' && <SalesWorkspace />}`. Remove only CSS selectors that target `.sales-workspace`; retain the shared `.tab-bar` and `.tab-button` rules because other tabs and external tools use them.

- [ ] **Step 4: Run the external-link test to verify it passes**

Run: `npx playwright test tests/e2e/scan-app.spec.js --project=chromium --grep "delivery system" --workers=1`

Expected: PASS and no navigation replaces the Scan to Sheet tab.

- [ ] **Step 5: Commit the UI slice**

```powershell
git add -- src/App.jsx src/styles.css tests/e2e/scan-app.spec.js tests/e2e/sales-quick-desk.spec.js
git commit -m "feat: link sidebar to delivery system"
```

### Task 2: Remove the retired Hillkoff integration and its configuration

**Files:**
- Create: `tests/api/delivery-system-link-only.test.js`
- Modify: `package.json`, `package-lock.json`, `README.md`, `.env.example`
- Delete: `.npmrc`, `api/hillkoff.js`, `lib/hillkoffGateway.js`
- Delete: `src/features/sales/SalesWorkspace.jsx`, `src/features/sales/api/salesApi.js`, `src/features/sales/api/salesApi.test.js`, `src/features/sales/customers/CustomerOperations.jsx`, `src/features/sales/orders/OrderOperations.jsx`, `src/features/sales/shared/models.js`, `src/features/sales/shared/models.test.js`, `src/features/sales/shared/workflowPayload.js`, `src/features/sales/shared/workflowPayload.test.js`
- Delete: `tests/api/hillkoff-client.test.js`, `tests/api/hillkoff-me.test.js`

**Interfaces:**
- Consumes: `node:test`, `node:assert/strict`, and `fs.existsSync`.
- Produces: a repository-level test proving the removed gateway/package cannot be reintroduced unnoticed.

- [ ] **Step 1: Write the failing removal guard**

Create `tests/api/delivery-system-link-only.test.js`:

```js
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

test('does not ship the retired Hillkoff API gateway', () => {
  assert.equal(existsSync(new URL('../../api/hillkoff.js', import.meta.url)), false);
  assert.equal(existsSync(new URL('../../lib/hillkoffGateway.js', import.meta.url)), false);
  assert.equal(packageJson.dependencies['@hillkoffzerowaste/sales-workspace'], undefined);
});
```

Append the new file to the `test:marketplace` command.

- [ ] **Step 2: Run the guard to verify it fails for the intended reason**

Run: `node --test tests/api/delivery-system-link-only.test.js`

Expected: FAIL because both gateway files and the shared-workspace dependency still exist.

- [ ] **Step 3: Remove only the retired integration**

Delete all files named in this task. Remove `@hillkoffzerowaste/sales-workspace` from `dependencies` and every retired sales/API test path from `test:marketplace`; then run:

```powershell
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
```

Remove the GitHub Packages `.npmrc`, the `HILLKOFF_API_KEY` line from `.env.example`, and the three README references to that variable. Do not alter historical spec/plan documents or any Vercel environment variable.

- [ ] **Step 4: Run the removal guard and the complete unit/API suite**

Run:

```powershell
node --test tests/api/delivery-system-link-only.test.js
npm run test:marketplace
```

Expected: Both commands exit 0, and `test:marketplace` contains no Hillkoff gateway or sales-workspace test path.

- [ ] **Step 5: Commit the removal slice**

```powershell
git add -- package.json package-lock.json README.md .env.example tests/api/delivery-system-link-only.test.js
git add -u -- .npmrc api/hillkoff.js lib/hillkoffGateway.js src/features/sales tests/api/hillkoff-client.test.js tests/api/hillkoff-me.test.js
git commit -m "refactor: remove embedded delivery integration"
```

### Task 3: Full verification and release

**Files:**
- Verify only; do not include uncommitted `packingVideo` paths in staging.

**Interfaces:**
- Consumes: final repository state after Tasks 1 and 2.
- Produces: evidence that Scan to Sheet contains the direct delivery link and no executable Hillkoff API integration.

- [ ] **Step 1: Prove no executable integration references remain**

Run:

```powershell
rg -n "sales-workspace|/api/hillkoff|hillkoffGateway|HILLKOFF_API_KEY|Sales Quick Desk" src api lib tests package.json .env.example README.md --glob '!docs/superpowers/**'
```

Expected: exit 1 with no matches. Historical documentation is deliberately excluded.

- [ ] **Step 2: Run production and browser checks**

Run:

```powershell
npm run build
npm run test:e2e
```

Expected: Vite build exits 0 and every Playwright test passes on Chromium and Mobile Chrome.

- [ ] **Step 3: Inspect release scope and commit/push**

Run:

```powershell
git diff --check origin/main...HEAD
git status --short
git push origin main
```

Expected: only the implementation commits are pushed; existing untracked `packingVideo` files remain unstaged and local.
