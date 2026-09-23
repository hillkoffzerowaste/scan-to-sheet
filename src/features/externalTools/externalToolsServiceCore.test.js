import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_EXTERNAL_TOOLS_CONFIG } from './externalToolsConfig.js';
import { createExternalToolsService } from './externalToolsServiceCore.js';

function createHarness(initialDocument = null) {
  let currentDocument = initialDocument;
  let snapshotListener;
  let listenerOptions;
  const writes = [];
  const service = createExternalToolsService({
    db: {},
    doc: (_db, collection, id) => ({ path: collection + '/' + id }),
    onSnapshot: (_ref, options, onNext) => {
      listenerOptions = options;
      snapshotListener = onNext;
      return () => {};
    },
    runTransaction: async (_db, update) => {
      const current = currentDocument;
      const snapshot = {
        exists: () => Boolean(current),
        data: () => current?.data,
      };
      const transaction = {
        get: async () => snapshot,
        set: (_ref, data) => {
          writes.push(data);
          currentDocument = { data };
        },
      };
      return update(transaction);
    },
    serverTimestamp: () => 'server-time',
    revisionFactory: () => 'revision-next',
  });

  return {
    ...service,
    writes,
    get listenerOptions() { return listenerOptions; },
    emit(snapshot) { snapshotListener(snapshot); },
    get currentDocument() { return currentDocument; },
    set currentDocument(value) { currentDocument = value; },
  };
}

function snapshot(exists, data, fromCache) {
  return {
    exists: () => exists,
    data: () => data,
    metadata: { fromCache },
  };
}

test('cache snapshots may populate navigation but do not mark shared settings ready', () => {
  const harness = createHarness();
  const changes = [];
  harness.subscribeExternalTools({ onChange: (config, metadata) => changes.push({ config, metadata }) });

  assert.equal(harness.listenerOptions.includeMetadataChanges, true);
  harness.emit(snapshot(false, undefined, true));
  assert.deepEqual(changes.at(-1), {
    config: DEFAULT_EXTERNAL_TOOLS_CONFIG,
    metadata: { source: 'cache', ready: false, version: null },
  });

  harness.emit(snapshot(false, undefined, false));
  assert.deepEqual(changes.at(-1), {
    config: DEFAULT_EXTERNAL_TOOLS_CONFIG,
    metadata: { source: 'firestore', ready: true, version: { exists: false, revision: null } },
  });
});

test('a server snapshot exposes a revision for optimistic concurrency checks', () => {
  const harness = createHarness({ data: { ...DEFAULT_EXTERNAL_TOOLS_CONFIG, revision: 'revision-current' } });
  let result;
  harness.subscribeExternalTools({ onChange: (_config, metadata) => { result = metadata; } });
  harness.emit(snapshot(true, { ...DEFAULT_EXTERNAL_TOOLS_CONFIG, revision: 'revision-current' }, false));

  assert.deepEqual(result, {
    source: 'firestore',
    ready: true,
    version: { exists: true, revision: 'revision-current' },
  });
});

test('saving a stale draft reports conflict without writing over the latest config', async () => {
  const latestConfig = {
    groups: [
      ...DEFAULT_EXTERNAL_TOOLS_CONFIG.groups,
      { id: 'new-group', name: 'เพิ่มจากเครื่องอื่น', links: [] },
    ],
  };
  const harness = createHarness({ data: { ...latestConfig, revision: 'revision-from-other-admin' } });

  await assert.rejects(
    harness.saveExternalToolsConfig(DEFAULT_EXTERNAL_TOOLS_CONFIG, { uid: 'admin-a' }, {
      exists: true,
      revision: 'revision-before-other-admin',
    }),
    (error) => error.code === 'EXTERNAL_TOOLS_CONFLICT',
  );

  assert.deepEqual(harness.writes, []);
  assert.equal(harness.currentDocument.data.revision, 'revision-from-other-admin');
  assert.equal(harness.currentDocument.data.groups.length, 2);
});

test('a transaction retry detects a write committed after the first read', async () => {
  const latestConfig = {
    groups: [
      ...DEFAULT_EXTERNAL_TOOLS_CONFIG.groups,
      { id: 'new-group', name: 'เพิ่มระหว่างบันทึก', links: [] },
    ],
  };
  let currentDocument = { data: { ...DEFAULT_EXTERNAL_TOOLS_CONFIG, revision: 'revision-before-race' } };
  let attempts = 0;
  const committedWrites = [];
  const service = createExternalToolsService({
    db: {},
    doc: (_db, collection, id) => ({ path: collection + '/' + id }),
    onSnapshot: () => () => {},
    runTransaction: async (_db, update) => {
      while (attempts < 2) {
        attempts += 1;
        const readDocument = currentDocument;
        let stagedWrite;
        const transaction = {
          get: async () => ({ exists: () => Boolean(readDocument), data: () => readDocument?.data }),
          set: (_reference, data) => { stagedWrite = data; },
        };
        await update(transaction);

        if (attempts === 1) {
          currentDocument = { data: { ...latestConfig, revision: 'revision-from-other-admin' } };
          continue;
        }

        committedWrites.push(stagedWrite);
        currentDocument = { data: stagedWrite };
      }
    },
    serverTimestamp: () => 'server-time',
    revisionFactory: () => 'stale-admin-revision',
  });

  await assert.rejects(
    service.saveExternalToolsConfig(DEFAULT_EXTERNAL_TOOLS_CONFIG, { uid: 'admin-a' }, {
      exists: true,
      revision: 'revision-before-race',
    }),
    (error) => error.code === 'EXTERNAL_TOOLS_CONFLICT',
  );

  assert.equal(attempts, 2);
  assert.deepEqual(committedWrites, []);
  assert.equal(currentDocument.data.revision, 'revision-from-other-admin');
  assert.equal(currentDocument.data.groups.length, 2);
});

test('saving against the current revision writes a new server revision', async () => {
  const harness = createHarness();
  const result = await harness.saveExternalToolsConfig(DEFAULT_EXTERNAL_TOOLS_CONFIG, { uid: 'admin-a' }, {
    exists: false,
    revision: null,
  });

  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0].revision, 'revision-next');
  assert.equal(harness.writes[0].updatedAt, 'server-time');
  assert.deepEqual(result.version, { exists: true, revision: 'revision-next' });
});
