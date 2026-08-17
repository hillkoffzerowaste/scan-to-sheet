import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PACKING_VIDEO_FIELDS } from "../src/services/packingVideoModel.js";

const readRules = () => readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const readStorageRules = () => readFile(new URL("../storage.rules", import.meta.url), "utf8");

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

test("a weekly duty only accepts a real weekday number", async () => {
  const rules = await readRules();
  const block = rules.match(/match \/staffWeeklyDuties\/\{weeklyDutyId\} \{([\s\S]*?)\n    \}/);

  assert.ok(block, "staffWeeklyDuties rules must exist");
  assert.match(block[1], /request\.resource\.data\.weekday is int/);
  assert.match(block[1], /request\.resource\.data\.weekday <= 6/);
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
