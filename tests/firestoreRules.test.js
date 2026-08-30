import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRules = () => readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const readStorageRules = () => readFile(new URL("../storage.rules", import.meta.url), "utf8");
const readSheetWriter = () => readFile(new URL("../src/services/googleSheets.js", import.meta.url), "utf8");
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

test("operational data requires an approved staff claim, not merely Firebase sign-in", async () => {
  const rules = await readRules();
  const storageRules = await readStorageRules();
  assert.match(rules, /function isOperationalStaff\(\)/);
  assert.match(rules, /request\.auth\.token\.operator == true/);
  assert.match(storageRules, /function isOperationalStaff\(\)/);
  for (const collection of ['staffMembers', 'staffDutyTypes', 'staffWeeklyDuties', 'staffDutyOverrides', 'staffDailyAssignments', 'staffDailyStatuses', 'staffDailyLeads', 'scanEvents', 'orders', 'couriers']) {
    const block = rules.match(new RegExp(`match /${collection}/\\{[^}]+\\} \\{([\\s\\S]*?)\\n    \\}`));
    assert.ok(block, `${collection} rules must exist`);
    assert.doesNotMatch(block[1], /allow (?:read|create|update|write)[^\n]*isSignedIn\(\)/);
  }
});

test("external operational text is never written to Sheets as a formula", async () => {
  const [sheetWriter, labelScript] = await Promise.all([readSheetWriter(), readLabelScript()]);
  assert.doesNotMatch(sheetWriter, /valueInputOption:\s*'USER_ENTERED'/);
  assert.doesNotMatch(sheetWriter, /valueInputOption=USER_ENTERED/);
  assert.match(labelScript, /function literalizeSheetText_\(value\)/);
  assert.match(labelScript, /setValue\(literalizeSheetText_\(value\)\)/);
});
