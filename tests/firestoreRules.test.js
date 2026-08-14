import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("staff private contacts allow Admin reads without write payload validation", async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  const match = rules.match(
    /match \/staffPrivateContacts\/\{staffId\} \{([\s\S]*?)\n    \}/
  );

  assert.ok(match, "staffPrivateContacts rules must exist");
  assert.match(match[1], /allow read: if isStaffAdmin\(\);/);
  assert.doesNotMatch(match[1], /allow read, create, update:/);
});
