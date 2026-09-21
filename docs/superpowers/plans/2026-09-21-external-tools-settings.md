# การตั้งค่าเครื่องมือภายนอก Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. ทำตาม checkbox ทีละขั้นและตรวจผลก่อน commit ของแต่ละ task

**Goal:** ให้ Firebase Admin จัดการหมวดและลิงก์เครื่องมือภายนอกที่ทุกเครื่องใช้ร่วมกันได้ โดยผู้ใช้ทั่วไปยังเปิดลิงก์ได้

**Architecture:** เก็บ groups และ links ไว้ใน `staffSettings/externalTools` เอกสารเดียวใน Firestore ให้ App subscribe เอกสารนั้นและส่งค่าที่ normalize แล้วไปยัง Sidebar กับหน้า settings. แยก pure validation/defaults ออกจาก Firestore I/O; เปิดให้แก้ไขหลังยืนยัน snapshot จาก server แล้ว และตรวจ revision ใน transaction เพื่อป้องกัน draft เก่าทับข้อมูลล่าสุด

**Tech Stack:** React 19, Firebase Firestore, Node.js `node:test`, Playwright, CSS variables ใน `src/styles.css`

**Spec:** [`docs/superpowers/specs/2026-09-21-external-tools-settings-design.md`](../specs/2026-09-21-external-tools-settings-design.md)

## Global Constraints

- ผู้ใช้ที่เป็น operational staff อ่านเอกสารได้; เฉพาะ UID ที่มี `adminUsers/{uid}` จึงสร้างหรือแก้ไขเอกสารได้
- สิทธิ์ Admin ต้องตรวจจาก Firebase ไม่ใช้สถานะ Google Sheet `isSignedIn` แทน
- Client validation จำกัดชื่อหมวดและชื่อ link ให้ไม่ว่าง, URL ให้ parse ได้และใช้ protocol `http:` หรือ `https:` เท่านั้น, URL ไม่เกิน 2,048 ตัวอักษร, หมวดไม่เกิน 10 และลิงก์รวมไม่เกิน 100 รายการ
- URL ภายนอกเปิดด้วย `target="_blank"` และ `rel="noopener noreferrer"`
- คงชื่อ, URL, การเปิดแท็บใหม่ และ `data-testid` ของลิงก์เริ่มต้นทั้ง 6 รายการ
- ข้อความที่ผู้ใช้เห็นและ error ต้องเป็นภาษาไทย; error ที่ทดสอบได้ต้องมี `code` ไม่ผูก test กับข้อความแสดงผล
- ใช้ CSS token ที่มีอยู่ ห้ามเพิ่ม `:root`, สี/มุมโค้ง hardcode, `transition: all`, hover lift หรือ backdrop blur บนการ์ด
- อ่านเอกสาร Firestore เพียงหนึ่ง doc และไม่เขียนเอกสารอัตโนมัติเมื่อยังไม่มีค่าที่ Admin บันทึก
- snapshot จาก cache ใช้แสดงลิงก์ได้ แต่ห้ามถือเป็นข้อมูลพร้อมบันทึก; ทุก write ต้องเทียบ revision ที่อ่านจาก server

## Review Focus

1. เอกสารยังไม่มี กับเอกสารที่บันทึก `groups: []` ต้องให้ผลต่างกัน — ทดสอบ default และ empty config ใน Task 1
2. document payload เสียรูปหรือมี URL `javascript:`/`data:` ต้องไม่สร้าง anchor ที่เปิดได้ — ทดสอบ normalization และ protocol ใน Task 1
3. ชื่อ/URL ว่าง, URL เกิน 2,048 ตัวอักษร, เกิน 10 หมวด หรือเกิน 100 ลิงก์ ต้องปฏิเสธก่อน write — ทดสอบ validation ใน Task 1 และ UI ใน Task 3
4. Firebase หายหรืออ่าน Firestore ถูกปฏิเสธ ต้องไม่ให้ settings บันทึก defaults ทับค่าร่วม — ทดสอบสถานะ load error และปุ่มบันทึกใน Task 3
5. ยกเลิกการลบหมวดที่มีลิงก์ต้องรักษาทั้งหมวดและลิงก์ไว้ — ทดสอบ browser dialog ใน Task 4
6. snapshot จาก cache ห้ามเปิดการบันทึก; ตรวจ metadata change จนถึง server snapshot — ทดสอบ service ใน Task 4
7. draft ที่เริ่มจาก revision เก่าห้ามเขียนทับ config ที่ Admin อีกเครื่องเพิ่งบันทึก — ตรวจด้วย Firestore transaction และทดสอบ conflict ใน Task 4

---

### Task 1: โมเดลค่าเริ่มต้นและ validation

**Files:**
- Create: `src/features/externalTools/externalToolsConfig.js`
- Create: `src/features/externalTools/externalToolsConfig.test.js`
- Modify: `package.json` — เพิ่ม test file ใน script `test:marketplace`

**Interfaces:**
- Produces: `DEFAULT_EXTERNAL_TOOLS_CONFIG`, `EXTERNAL_TOOL_TEST_IDS`, `normalizeExternalToolsConfig(value)`, `validateExternalToolsConfig(value)`
- `normalizeExternalToolsConfig` คืน `{ groups }` ที่ผ่านการตรวจ หรือ `null` เมื่อ payload เสียรูป; empty `groups` เป็นข้อมูลที่ถูกต้อง
- `validateExternalToolsConfig` คืน `{ groups }` ที่ normalized หรือ throw Error ที่มี `code: 'EXTERNAL_TOOLS_INVALID'` และข้อความไทย

- [x] **Step 1: เขียน unit tests ที่ล้มเหลวก่อนมีโมดูล**

ทดสอบหกลิงก์เดิมและ test IDs, empty groups, ID ซ้ำ, ชื่อว่าง, URL ที่ไม่ใช่ HTTP(S), URL ยาวเกินกำหนด และจำนวนหมวด/ลิงก์เกินขอบเขต

```js
const configWithLink = (url) => ({
  groups: [{ id: 'group-a', name: 'Tools', links: [{ id: 'link-a', label: 'Search', url }] }],
});

test('keeps an intentionally empty saved configuration', () => {
  assert.deepEqual(normalizeExternalToolsConfig({ groups: [] }), { groups: [] });
});

test('rejects executable URL protocols with a stable error code', () => {
  assert.throws(
    () => validateExternalToolsConfig(configWithLink('javascript:alert(1)')),
    (error) => error.code === 'EXTERNAL_TOOLS_INVALID',
  );
});
```

- [x] **Step 2: ยืนยันว่า tests ล้มเพราะยังไม่มี exports**

Run: `node --test src/features/externalTools/externalToolsConfig.test.js`
Expected: FAIL เพราะ `externalToolsConfig.js` ยังไม่มี exports

- [x] **Step 3: เพิ่มค่าเริ่มต้นและ pure validation**

กำหนด stable IDs ให้หกลิงก์เดิม และแยก `data-testid` เดิมไว้ใน `EXTERNAL_TOOL_TEST_IDS`; custom IDs ต้องไม่สร้าง test ID ที่ชนกับค่าเดิม ใช้ `new URL(value.trim())` และยอมรับเฉพาะ `http:`/`https:` พร้อม hostname

```js
export function validateExternalToolsConfig(value) {
  const normalized = normalizeExternalToolsConfig(value);
  if (!normalized) {
    throw Object.assign(new Error('ตรวจสอบชื่อหมวดและลิงก์อีกครั้ง'), {
      code: 'EXTERNAL_TOOLS_INVALID',
    });
  }
  return normalized;
}
```

- [x] **Step 4: ผนวก test file เข้า script และรันชุดหลัก**

เพิ่ม `src/features/externalTools/externalToolsConfig.test.js` ในรายการ `node --test` ของ `test:marketplace` โดยคงไฟล์ทดสอบเดิมทั้งหมด

Run: `node --test src/features/externalTools/externalToolsConfig.test.js`
Expected: PASS

Run: `npm run test:marketplace`
Expected: PASS รวม test file ใหม่

- [x] **Step 5: Commit โมเดลและ tests**

```bash
git add package.json src/features/externalTools/externalToolsConfig.js src/features/externalTools/externalToolsConfig.test.js
git commit -m "feat: define external tools settings model"
```

### Task 2: Firestore repository และ Rules

**Files:**
- Create: `src/features/externalTools/externalToolsService.js`
- Create: `src/features/externalTools/externalToolsServiceCore.js`
- Create: `src/features/externalTools/externalToolsServiceCore.test.js`
- Modify: `firestore.rules`
- Modify: `tests/firestoreRules.test.js`

**Interfaces:**
- Consumes: `normalizeExternalToolsConfig`, `validateExternalToolsConfig` จาก Task 1 และ `firestoreDb` / `serverTimestamp` จาก `src/services/firebase.js`
- Produces: `subscribeExternalTools({ onChange, onError })` ซึ่งคืน unsubscribe; `onChange(config, { source, ready, version })` แยก snapshot จาก cache กับ server
- Produces: `saveExternalToolsConfig(config, firebaseUser, expectedVersion)` ซึ่งตรวจ client payload และ revision ใน transaction ก่อนเขียนเอกสารพร้อม revision ใหม่, server timestamp และ `updatedByUid`

- [x] **Step 1: เขียน Rule regression test ก่อนเพิ่ม Rule**

ใน `tests/firestoreRules.test.js` ให้ดึง block ของ `/staffSettings/externalTools` แล้วตรวจ read=`isOperationalStaff()`, create/update=`isStaffAdmin()`, จำกัด keys/groups, ตรวจ timestamp/UID และปิด delete

```js
test('external tool settings are shared for staff and writable only by Admin', async () => {
  const rules = await readRules();
  const block = rules.match(/match \/staffSettings\/externalTools \{([\s\S]*?)\n    \}/);
  assert.ok(block, 'externalTools settings rules must exist');
  assert.match(block[1], /allow read: if isOperationalStaff\(\);/);
  assert.match(block[1], /allow create, update: if isStaffAdmin\(\)/);
  assert.match(block[1], /request\.resource\.data\.groups\.size\(\) <= 10/);
  assert.match(block[1], /request\.resource\.data\.updatedAt == request\.time/);
  assert.match(block[1], /request\.resource\.data\.updatedByUid == request\.auth\.uid/);
  assert.match(block[1], /allow delete: if false;/);
});
```

- [x] **Step 2: ยืนยันว่า Rule regression test ล้ม**

Run: `node --test tests/firestoreRules.test.js`
Expected: FAIL เพราะยังไม่มี match block ของ `externalTools`

- [x] **Step 3: เพิ่ม Rule สำหรับเอกสารร่วม**

เพิ่ม match block เฉพาะ `staffSettings/externalTools`; อ่านได้เฉพาะ operational staff; create/update เฉพาะ Admin; ยอมรับเฉพาะ `groups`, `revision`, `updatedAt`, `updatedByUid`; จำกัดจำนวน groups ไว้ที่ 10; ตรวจ `updatedAt == request.time` และ UID ผู้เขียนตรงกับ `request.auth.uid`; ปิด delete

```text
match /staffSettings/externalTools {
  allow read: if isOperationalStaff();
  allow create, update: if isStaffAdmin()
    && request.resource.data.keys().hasOnly(['groups', 'revision', 'updatedAt', 'updatedByUid'])
    && request.resource.data.groups is list
    && request.resource.data.groups.size() <= 10
    && request.resource.data.revision is string
    && request.resource.data.updatedAt == request.time
    && request.resource.data.updatedByUid == request.auth.uid;
  allow delete: if false;
}
```

- [x] **Step 4: เพิ่ม repository ที่ไม่ throw แบบ sync เมื่อ Firebase ใช้ไม่ได้**

ใช้ `onSnapshot` พร้อม `includeMetadataChanges`; ส่ง `ready: false` สำหรับ cache snapshot และรอ server ก่อนเปิดการบันทึก. snapshot จาก server ที่ไม่มีเอกสารส่ง default config; payload จาก server ที่ผิดรูปเรียก `onError`. ให้แกน service รับ Firestore dependencies ผ่าน factory เพื่อทดสอบ cache, save conflict และ successful transaction ด้วย unit tests. Save อ่านเอกสารใน transaction, ปฏิเสธเมื่อ `exists`/`revision` ไม่ตรงกับ draft และเขียน revision ใหม่พร้อม `serverTimestamp()`; ห้ามใช้ `isSignedIn` เป็นสิทธิ์เขียน

```js
export async function saveExternalToolsConfig(config, firebaseUser, expectedVersion) {
  const normalized = validateExternalToolsConfig(config);
  if (!firestoreDb || !firebaseUser?.uid) {
    throw Object.assign(new Error('ต้องเข้าสู่ระบบ Firebase ในฐานะ Admin'), {
      code: 'EXTERNAL_TOOLS_AUTH_REQUIRED',
    });
  }
  const reference = doc(firestoreDb, 'staffSettings', 'externalTools');
  const revision = crypto.randomUUID();
  await runTransaction(firestoreDb, async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!matchesVersion(snapshot, expectedVersion)) {
      throw Object.assign(new Error('มี Admin อีกเครื่องบันทึกค่าล่าสุดแล้ว'), {
        code: 'EXTERNAL_TOOLS_CONFLICT',
      });
    }
    transaction.set(reference, {
      ...normalized,
      revision,
      updatedAt: serverTimestamp(),
      updatedByUid: firebaseUser.uid,
    });
  });
  return { config: normalized, version: { exists: true, revision } };
}
```

- [x] **Step 5: รัน Rule tests และชุดหลักก่อน commit**

Run: `node --test tests/firestoreRules.test.js`
Expected: PASS รวมข้อกำหนด staff settings ใหม่

Run: `npm run test:marketplace`
Expected: PASS

```bash
git add firestore.rules tests/firestoreRules.test.js src/features/externalTools/externalToolsService.js
git commit -m "feat: store external tools settings in Firestore"
```

### Task 3: หน้า Admin และการเชื่อมกับ App/Sidebar

**Files:**
- Create: `src/features/externalTools/ExternalToolsSettings.jsx`
- Create: `tests/e2e/external-tools-settings.spec.js`
- Modify: `src/App.jsx`
- Modify: `src/shell/Sidebar.jsx`
- Modify: `src/shell/StatusBar.jsx`
- Modify: `src/styles.css`
- Modify: `tests/e2e/mock-app.js` — mock repository สำหรับ Playwright

**Interfaces:**
- Consumes: `subscribeExternalTools`, `saveExternalToolsConfig`, `getStaffAdminStatus`, และ `DEFAULT_EXTERNAL_TOOLS_CONFIG`
- Produces: `ExternalToolsSettings({ config, loadStatus, saving, onSave })`; view เปลี่ยน local draft จนกดบันทึก แล้วส่ง `{ groups }` ให้ `onSave`
- App เป็นเจ้าของ shared config/subscription และส่ง groups ให้ Sidebar; Settings navigation แสดงให้ Firebase Admin เท่านั้น

- [x] **Step 1: เพิ่ม E2E test สำหรับ admin-only settings entry ก่อน integration**

เพิ่ม mock repository ใน `mock-app.js` แล้วเพิ่ม test ที่เปิดแอปในฐานะ Admin และ non-Admin; test ต้องเห็น entry เฉพาะ Admin และต้องเห็นลิงก์เริ่มต้นเดิมสำหรับทั้งคู่

```js
test('shows external tools settings only to Firebase Admins', async ({ page }) => {
  await openSignedInApp(page, { staffAdmin: true });
  await expect(page.getByTestId('external-tools-settings-tab')).toBeVisible();
  await page.getByTestId('external-tools-settings-tab').click();
  await expect(page.locator('.external-tools-settings')).toBeVisible();
});
```

- [x] **Step 2: รัน test ใหม่เพื่อยืนยันว่า UI ยังไม่มี entry**

Run: `npx playwright test tests/e2e/external-tools-settings.spec.js --project=chromium`
Expected: FAIL ที่ assertion ของ `external-tools-settings-tab`

- [x] **Step 3: สร้าง settings view พร้อม draft และการยืนยันลบหมวด**

สร้างฟอร์มชื่อหมวดและแถวลิงก์ที่เพิ่ม/แก้/ลบได้; กลุ่มใหม่เริ่มด้วยลิงก์ว่าง; ยืนยันลบหมวดด้วย `window.confirm` ที่ใช้ข้อความไทยและแจ้งว่าจะนำลิงก์ในหมวดนั้นออกด้วย; การยืนยันเปลี่ยน draft และปุ่ม “บันทึกการเปลี่ยนแปลง” ส่งทั้ง config ผ่าน validator เพื่อเขียน atomic

```jsx
const [draft, setDraft] = useState(config);
const [dirty, setDirty] = useState(false);

useEffect(() => {
  if (!dirty) setDraft(config);
}, [config, dirty]);
```

สร้าง ID ของหมวดและลิงก์ใหม่ด้วย `crypto.randomUUID()` และป้องกัน ID ซ้ำใน validator

เมื่อ `loadStatus !== 'ready'` ให้ปิด inputs และปุ่มบันทึก; เมื่อ validation/save ล้มเหลวให้แสดงข้อความไทยจาก error code โดยไม่แสดงรายละเอียด Firestore

- [x] **Step 4: ผูก subscription, สิทธิ์ Admin และแท็บเข้ากับ App**

ใน `App.jsx` ตรวจ `getStaffAdminStatus(firebaseUser.uid)`; subscribe เอกสารร่วมเมื่อมี Firebase user; ค่าเริ่มต้นใช้ได้เมื่อ snapshot ไม่มีเอกสารหรือ Firebase ไม่ได้ตั้งค่า; เมื่ออ่านผิดพลาดให้คงค่าล่าสุดและปิดการบันทึก; cleanup unsubscribe เมื่อ user เปลี่ยนหรือ unmount; guard `switchTab` ไม่ให้เปิด settings สำหรับ non-Admin

เพิ่ม `externalToolsGroups` และ `canManageExternalTools` props ใน Sidebar, render heading/anchor ตาม config และคง test IDs สำหรับ link ID เริ่มต้น; เพิ่ม settings item สำหรับ Admin; render view เมื่อ `activeTab === 'external-tools-settings'`; เพิ่ม label ของ tab นี้ใน `StatusBar.jsx`

- [x] **Step 5: เพิ่ม CSS ตาม token contract และตรวจ build**

เพิ่มกฎ `.win-shell .external-tools-settings...` ใน `styles.css`; ใช้ `--surface`, `--text`, `--muted`, `--line`, `--control-line`, `--radius-sm/md`, `--control-height`, `--ui-*`; ทุก control มี focus ที่เห็นได้, ไม่มีข้อความต่ำกว่า 12px และไม่มี hover lift/transition all

Run: `npx playwright test tests/e2e/external-tools-settings.spec.js --project=chromium`
Expected: PASS settings entry permission and settings page rendering

Run: `npm run build`
Expected: PASS

```bash
git add src/App.jsx src/shell/Sidebar.jsx src/shell/StatusBar.jsx src/styles.css src/features/externalTools/ExternalToolsSettings.jsx tests/e2e/mock-app.js tests/e2e/external-tools-settings.spec.js
git commit -m "feat: add external tools admin settings view"
```

### Task 4: ครอบคลุม CRUD, permission และตรวจหน้าจอจริง

**Files:**
- Modify: `tests/e2e/external-tools-settings.spec.js`
- Modify: `tests/e2e/mock-app.js`
- Modify: `tests/e2e/modern-workspace.spec.js`
- Modify: `src/features/externalTools/externalToolsServiceCore.test.js`

**Interfaces:**
- Consumes: stable test IDs and accessible controls from Task 3; `window.externalToolsConfig` and `window.externalToolsWrites` from test mocks
- Produces: regression evidence for default config, full CRUD, delete confirmation, permission denial, and layout

- [x] **Step 1: เพิ่ม browser tests สำหรับการจัดการหมวด/ลิงก์ครบ**

ให้ mock `saveExternalToolsConfig` เก็บ payload ที่บันทึกใน `window.externalToolsWrites` และจำลองให้ `subscribeExternalTools` ส่งค่าใหม่หลังบันทึก; ทดสอบ rename/delete หมวดเดิม, เพิ่มหมวด, edit/delete ลิงก์เดิม และเพิ่มลิงก์ใหม่

```js
await page.getByTestId('external-tools-settings-tab').click();
await page.getByLabel('ชื่อหมวด 1').fill('ระบบคลัง');
await page.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง' }).click();
await expect(page.getByRole('heading', { name: 'ระบบคลัง' })).toBeVisible();
```

- [x] **Step 2: ทดสอบยกเลิกและยืนยันการลบหมวดที่มีลิงก์**

ใช้ Playwright `page.once('dialog', dialog => dialog.dismiss())` เพื่อยืนยันว่าการยกเลิกไม่เพิ่ม write; รอบถัดไป accept dialog, บันทึก และยืนยันว่าหมวดกับลิงก์หายจาก Sidebar

- [x] **Step 3: ทดสอบ invalid config, read failure และ non-Admin**

ยืนยันว่า `javascript:` และเกินขอบเขตไม่ทำให้เกิด write, read error ปิดการบันทึก, ผู้ใช้ non-Admin ไม่มี settings entry และยังเปิด default links ในแท็บใหม่ได้; error assertions ตรวจ `data-error-code` ที่ผูกกับ `error.code` ไม่ตรวจข้อความแสดงผล

- [x] **Step 4: รวมหน้า settings เข้า visual audit**

เพิ่ม tab `external-tools-settings` ใน loop ของ `modern-workspace.spec.js` เฉพาะกรณี Admin; ตรวจ light/dark ที่ 1280, 1440 และ 1920px ด้วย `auditRenderedContrast`, page overflow 0px และไม่มีข้อความถูกตัด

- [x] **Step 5: รัน E2E ที่เกี่ยวข้องและเปิดหน้าจอจริง**

Run: `npx playwright test tests/e2e/external-tools-settings.spec.js tests/e2e/modern-workspace.spec.js --project=chromium`
Expected: PASS ทุกกรณีที่เกี่ยวกับ sidebar, permissions, CRUD, contrast และ layout

เปิดแอปผ่าน preview ของ workspace แล้วตรวจทั้งสองธีมที่ 1280/1440/1920 โดยใช้ Admin mock สำหรับหน้า settings; ตรวจว่า default links ยังเปิดด้วย target/rel เดิม และข้อมูลที่ save ปรากฏที่ Sidebar โดยไม่ reload

ทดสอบ service core เพิ่ม: cache-only snapshot ไม่พร้อมเขียน, server snapshot ให้ revision, stale transaction ถูกปฏิเสธโดยไม่เขียน, transaction retry หลังคู่แข่ง commit แล้วปฏิเสธ draft เก่า และ current transaction บันทึก revision ใหม่. E2E จำลอง server conflict ก่อน snapshot มาถึงและยืนยันว่าไม่มี write จนโหลดค่าล่าสุด

- [x] **Step 6: รันชุดบังคับและตรวจ diff สุดท้าย**

Run: `npm run test:marketplace`
Expected: PASS

Run: `npm run build`
Expected: PASS

Run: `git diff --check`
Expected: ไม่มี whitespace errors; ตรวจ `git status --short` ว่าไม่มีไฟล์นอกขอบเขตเปลี่ยน

```bash
git add tests/e2e/external-tools-settings.spec.js tests/e2e/mock-app.js tests/e2e/modern-workspace.spec.js
git commit -m "test: cover shared external tools settings"
```
