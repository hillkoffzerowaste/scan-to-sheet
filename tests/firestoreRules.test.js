import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PACKING_VIDEO_FIELDS } from "../src/services/packingVideoModel.js";

const readRules = () => readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const readStorageRules = () => readFile(new URL("../storage.rules", import.meta.url), "utf8");
const readSheetWriter = () => readFile(new URL("../src/services/googleSheets.js", import.meta.url), "utf8");
const readPackingVideoSheetWriter = () => readFile(new URL("../src/services/packingVideoSheet.js", import.meta.url), "utf8");
const readLabelScript = () => readFile(new URL("../apps-script/label-sync/Code.gs", import.meta.url), "utf8");

test("staff private contacts allow Admin reads without write payload validation", async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  const match = rules.match(
    /match \/staffPrivateContacts\/\{staffId\} \{([\s\S]*?)\n    \}/
  );

  assert.ok(match, "staffPrivateContacts rules must exist");
  assert.match(match[1], /allow read: if isStaffAdmin\(\);/);
  assert.doesNotMatch(match[1], /allow read, create, update:/);
});

test("a per-day duty change is pinned to the date in its own document id", async () => {
  // Without the id check an Admin could write a change for one date into another date's slot,
  // which would silently move a substitute onto the wrong day of the fixed roster.
  const rules = await readRules();
  const block = rules.match(/match \/staffDutyOverrides\/\{overrideId\} \{([\s\S]*?)\n    \}/);

  assert.ok(block, "staffDutyOverrides rules must exist");
  assert.match(
    block[1],
    /overrideId == request\.resource\.data\.date \+ '__' \+ request\.resource\.data\.weeklyDutyId/
  );
  assert.match(block[1], /request\.resource\.data\.date\.size\(\) == 10/);
});

test("a weekly duty only accepts a real weekday number and a real staff member", async () => {
  const rules = await readRules();
  const block = rules.match(/match \/staffWeeklyDuties\/\{weeklyDutyId\} \{([\s\S]*?)\n    \}/);

  assert.ok(block, "staffWeeklyDuties rules must exist");
  assert.match(block[1], /request\.resource\.data\.weekday is int/);
  assert.match(block[1], /request\.resource\.data\.weekday <= 6/);
  assert.match(block[1], /staffExists\(request\.resource\.data\.staffId\)/);
});

test("a per-day change keeps the empty substitute that means the duty is dropped", async () => {
  const rules = await readRules();
  const block = rules.match(/match \/staffDutyOverrides\/\{overrideId\} \{([\s\S]*?)\n    \}/);

  assert.ok(block, "staffDutyOverrides rules must exist");
  assert.match(block[1], /request\.resource\.data\.staffId == ''/);
  assert.match(block[1], /staffExists\(request\.resource\.data\.staffId\)/);
});

test("the packing video field whitelist matches the shared model exactly", async () => {
  // The Drive worker writes through firebase-admin, which skips these rules. If the two lists
  // ever drift, the worker can leave a document the client is no longer allowed to update and
  // the whole upload batch fails — the failure AGENTS.md records for the marketplace sync.
  const rules = await readRules();
  const block = rules.match(/function packingVideoFields\(\) \{\s*return \[([\s\S]*?)\];/);

  assert.ok(block, "packingVideoFields() must exist");
  const declared = [...block[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
  assert.deepEqual(declared.sort(), [...PACKING_VIDEO_FIELDS].sort());
});

test("nobody can delete a packing video, not even an Admin", async () => {
  const rules = await readRules();
  const block = rules.match(/match \/packingVideos\/\{videoId\} \{([\s\S]*?)\n    \}/);

  assert.ok(block, "packingVideos rules must exist");
  assert.match(block[1], /allow delete: if false;/);
  // A packer may only touch their own recording.
  assert.match(block[1], /resource\.data\.createdByUid == request\.auth\.uid/);
});

test("the attempt counter can only ever move up by one", async () => {
  const rules = await readRules();
  const block = rules.match(/match \/packingVideoTracking\/\{tracking\} \{([\s\S]*?)\n    \}/);

  assert.ok(block, "packingVideoTracking rules must exist");
  assert.match(block[1], /lastAttemptNo == resource\.data\.lastAttemptNo \+ 1/);
  assert.match(block[1], /allow delete: if false;/);
});

test("the packing video audit trail is append-only and Admin-only to read", async () => {
  const rules = await readRules();
  const block = rules.match(/match \/packingVideoAudit\/\{eventId\} \{([\s\S]*?)\n    \}/);

  assert.ok(block, "packingVideoAudit rules must exist");
  assert.match(block[1], /allow read: if isStaffAdmin\(\);/);
  assert.match(block[1], /allow update, delete: if false;/);
  assert.match(block[1], /request\.resource\.data\.at == request\.time/);
});

test("order audit events are append-only and cover every Sheet outbox transition", async () => {
  const rules = await readRules();
  const block = rules.match(/match \/orderAuditEvents\/\{eventId\} \{([\s\S]*?)\n    \}/);

  assert.ok(block, "orderAuditEvents rules must exist");
  assert.match(block[1], /allow update, delete: if false;/);
  assert.match(block[1], /request\.resource\.data\.actor\.uid == request\.auth\.uid/);
  assert.match(block[1], /'sheet_sync_writing'/);
  assert.match(block[1], /'sheet_sync_verified'/);
  assert.match(block[1], /'status_repaired'/);
});

test("stored packing video objects are immutable and packers cannot delete them", async () => {
  const rules = await readStorageRules();
  const block = rules.match(
    /match \/packing-videos\/\{dateFolder\}\/\{fileName\} \{([\s\S]*?)\n    \}/
  );

  assert.ok(block, "packing-videos storage rules must exist");
  assert.match(block[1], /allow update: if false;/);
  assert.match(block[1], /allow delete: if isStaffAdmin\(\);/);
  assert.match(block[1], /contentType\.matches\('video\/\.\*'\)/);
});

test("operational data and packing evidence require an approved staff claim, not merely Firebase sign-in", async () => {
  const rules = await readRules();
  const storageRules = await readStorageRules();
  assert.match(rules, /function isOperationalStaff\(\)/);
  assert.match(rules, /request\.auth\.token\.operator == true/);
  assert.match(storageRules, /function isOperationalStaff\(\)/);
  for (const collection of ['staffMembers', 'staffDutyTypes', 'staffWeeklyDuties', 'staffDutyOverrides', 'staffDailyAssignments', 'staffDailyStatuses', 'staffDailyLeads', 'scanEvents', 'orders', 'marketplaceOrders', 'packingVideos', 'packingVideoTracking', 'couriers']) {
    const block = rules.match(new RegExp(`match /${collection}/\\{[^}]+\\} \\{([\\s\\S]*?)\\n    \\}`));
    assert.ok(block, `${collection} rules must exist`);
    assert.doesNotMatch(block[1], /allow (?:read|create|update|write)[^\n]*isSignedIn\(\)/);
  }
});

test("every packingVideos query the Drive worker runs has a composite index", async () => {
  // Firestore needs a composite index for one equality filter plus an orderBy on another
  // field. Two of the worker's three queries had none — movePending's index was missing the
  // `status` equality and purgeMovedObjects had no index at all — so both would fail with
  // FAILED_PRECONDITION and nothing would ever be archived or cleaned up.
  const indexes = JSON.parse(
    await readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8")
  ).indexes;

  const has = (fields) => indexes.some((index) => (
    index.collectionGroup === "packingVideos"
    && index.fields.length === fields.length
    && index.fields.every((field, position) => field.fieldPath === fields[position])
  ));

  // movePending: driveStatus == 'pending' AND status == 'uploaded' ORDER BY uploadedAt
  assert.ok(has(["driveStatus", "status", "uploadedAt"]), "movePending index missing");
  // purgeMovedObjects: driveStatus == 'moved' ORDER BY movedToDriveAt
  assert.ok(has(["driveStatus", "movedToDriveAt"]), "purgeMovedObjects index missing");
  // reclaimStalledMoves: driveStatus == 'moving' ORDER BY updatedAt
  assert.ok(has(["driveStatus", "updatedAt"]), "reclaimStalledMoves index missing");
});

test("external operational text is never written to Sheets as a formula", async () => {
  const [sheetWriter, packingVideoSheetWriter, labelScript] = await Promise.all([readSheetWriter(), readPackingVideoSheetWriter(), readLabelScript()]);
  assert.doesNotMatch(sheetWriter, /valueInputOption:\s*'USER_ENTERED'/);
  assert.doesNotMatch(sheetWriter, /valueInputOption=USER_ENTERED/);
  assert.doesNotMatch(packingVideoSheetWriter, /valueInputOption=USER_ENTERED/);
  assert.match(labelScript, /function literalizeSheetText_\(value\)/);
  assert.match(labelScript, /setValue\(literalizeSheetText_\(value\)\)/);
});
