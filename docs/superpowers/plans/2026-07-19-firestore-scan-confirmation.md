# Firestore Scan Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the packer and Drive scan screens from reporting success unless the primary Firestore order write has been acknowledged.

**Architecture:** The existing Firestore transaction remains the sole primary write. The legacy Google Sheets fallback will no longer be treated as a Firestore-confirmed scan: a small pure helper returns an explicit `firestore_unconfirmed` outcome if the mirror cannot confirm Firestore, and the UI presents an error rather than success. The same helper is used by both scan modes so the fix cannot diverge.

**Tech Stack:** React 19, Vite, Firebase Firestore, Node built-in test runner.

## Global Constraints

- Preserve the current Firestore-first transaction and duplicate behaviour.
- Do not make a successful Google Sheet append appear as a successful Firestore scan.
- Add a regression test that fails before the implementation and run it directly plus the existing marketplace test suite and production build.
- Do not stage or alter existing untracked runtime/test-output directories.

---

### Task 1: Confirm fallback persistence before reporting scan success

**Files:**
- Create: `src/services/scanCommit.js`
- Create: `src/services/scanCommit.test.js`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `appendToSheet(): Promise<ScanResult>` and `mirrorToFirestore(ScanResult): Promise<void>`.
- Produces: `commitFallbackScan({ appendToSheet, mirrorToFirestore }): Promise<ScanResult | FirestoreUnconfirmedResult>`.
- `FirestoreUnconfirmedResult` has `status: 'firestore_unconfirmed'`, the original scan fields, and a user-safe `message`.

- [ ] **Step 1: Write the failing test**

```js
test('commitFallbackScan does not return success when the Firestore mirror rejects', async () => {
  const result = await commitFallbackScan({
    appendToSheet: async () => ({ status: 'success', code: 'JTTH201542488210' }),
    mirrorToFirestore: async () => { throw new Error('Firestore unavailable'); },
  });

  assert.equal(result.status, 'firestore_unconfirmed');
  assert.match(result.message, /Firestore/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/scanCommit.test.js`

Expected: FAIL because `scanCommit.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
export async function commitFallbackScan({ appendToSheet, mirrorToFirestore }) {
  const result = await appendToSheet();
  try {
    await mirrorToFirestore(result);
    return result;
  } catch (error) {
    return {
      ...result,
      status: 'firestore_unconfirmed',
      message: `บันทึก Google Sheet แล้ว แต่ Firestore ไม่ยืนยัน: ${error.message}`,
    };
  }
}
```

Update both fallback branches in `src/App.jsx` to call this helper before any success state, and render `firestore_unconfirmed` with the existing error feedback path. Update `mirrorScanToFirestore` to reject when the Firestore writer is unavailable, so its caller can distinguish no write from a confirmed event write.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/scanCommit.test.js`

Expected: PASS with both success and mirror-failure assertions.

- [ ] **Step 5: Verify integration**

Run: `npm run test:marketplace` and `npm run build`

Expected: exit code 0 for both commands.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/services/firebaseScans.js src/services/scanCommit.js src/services/scanCommit.test.js docs/superpowers/plans/2026-07-19-firestore-scan-confirmation.md
git commit -m "fix(scanner): require Firestore confirmation for scan success"
```
