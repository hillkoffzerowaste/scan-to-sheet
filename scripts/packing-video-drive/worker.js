#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
// google-auth-library ships with firebase-admin, so the Drive REST calls below need no extra
// dependency. The full `googleapis` client would add tens of megabytes for four endpoints.
import { GoogleAuth } from 'google-auth-library';

import { PACKING_VIDEO_FIELDS } from '../../src/services/packingVideoModel.js';
import {
  MAX_DRIVE_ATTEMPTS,
  buildDriveFolderPath,
  buildDriveNameForDoc,
  extensionFromMimeType,
  planDriveRetry,
  planStoragePurge,
  toDate,
} from './drivePaths.js';

/**
 * Moves uploaded packing videos from Firebase Storage into a Google Drive shared drive.
 *
 * Runs as a scheduled Node process on an office machine, not on Vercel: each pass streams
 * tens of megabytes per clip, which does not fit a serverless invocation.
 *
 * Access is a service account on a shared drive rather than a signed-in user's `drive.file`
 * token. Files then belong to the organisation instead of to whichever employee last logged
 * in — a staff departure must not orphan a year of dispute evidence.
 */

const BASE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.join(BASE_DIR, 'config.json');
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const BATCH_SIZE = 25;
const DEFAULT_INTERVAL_SECONDS = 60;
// Each pass costs a Firestore query even when nothing is waiting, so the floor keeps a typo
// like `--interval 1` from turning an idle night into ~30k billed reads.
const MIN_INTERVAL_SECONDS = 15;

async function loadConfig() {
  try {
    return JSON.parse(await readFile(DEFAULT_CONFIG_PATH, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`Missing ${DEFAULT_CONFIG_PATH}. Copy config.example.json and fill it in.`);
  }
}

function initFirebase(config) {
  if (!getApps().length) {
    initializeApp({
      credential: cert(path.resolve(BASE_DIR, '../..', config.serviceAccountPath)),
      storageBucket: config.storageBucket,
    });
  }
  return { db: getFirestore(), bucket: getStorage().bucket() };
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

async function initDrive(config) {
  const auth = new GoogleAuth({
    keyFile: path.resolve(BASE_DIR, '../..', config.driveServiceAccountPath ?? config.serviceAccountPath),
    scopes: [DRIVE_SCOPE],
  });
  const client = await auth.getClient();

  async function call(url, options = {}) {
    const { token } = await client.getAccessToken();
    const response = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw Object.assign(new Error(`Drive responded ${response.status}`), {
        status: response.status,
        detail,
      });
    }
    return response.status === 204 ? null : response.json();
  }

  return { call, getAccessToken: async () => (await client.getAccessToken()).token };
}

/** Resolves (creating as needed) a folder chain, memoised for the run. */
async function ensureFolderPath(drive, driveId, segments, cache) {
  let parentId = driveId;
  let key = '';

  for (const segment of segments) {
    key = `${key}/${segment}`;
    if (cache.has(key)) {
      parentId = cache.get(key);
      continue;
    }

    const escaped = segment.replace(/'/g, "\\'");
    const params = new URLSearchParams({
      q: `name='${escaped}' and mimeType='application/vnd.google-apps.folder'`
        + ` and '${parentId}' in parents and trashed=false`,
      fields: 'files(id)',
      pageSize: '1',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      corpora: 'drive',
      driveId,
    });

    const found = await drive.call(`${DRIVE_API}/files?${params}`);
    let folderId = found.files?.[0]?.id;

    if (!folderId) {
      const created = await drive.call(`${DRIVE_API}/files?fields=id&supportsAllDrives=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: segment,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId],
        }),
      });
      folderId = created.id;
    }

    cache.set(key, folderId);
    parentId = folderId;
  }

  return parentId;
}

/**
 * Resumable upload: a clip is tens of megabytes, and a single dropped request should not send
 * the whole transfer back to the start.
 */
async function uploadToDrive({ drive, name, parentId, mimeType, stream, sizeBytes }) {
  const token = await drive.getAccessToken();
  const start = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,webViewLink&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': mimeType,
        ...(sizeBytes ? { 'X-Upload-Content-Length': String(sizeBytes) } : {}),
      },
      body: JSON.stringify({ name, parents: [parentId] }),
    },
  );

  if (!start.ok) {
    throw Object.assign(new Error(`Drive upload init failed (${start.status})`), {
      status: start.status,
      detail: await start.text(),
    });
  }

  const sessionUrl = start.headers.get('location');
  if (!sessionUrl) throw new Error('Drive did not return a resumable session URL');

  const upload = await fetch(sessionUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: stream,
    duplex: 'half',
  });

  if (!upload.ok) {
    throw Object.assign(new Error(`Drive upload failed (${upload.status})`), {
      status: upload.status,
      detail: await upload.text(),
    });
  }

  return upload.json();
}

async function moveOne({ drive, bucket, db, config, doc, folderCache }) {
  const data = doc.data();
  const ref = doc.ref;

  await ref.update({ driveStatus: 'moving', updatedAt: FieldValue.serverTimestamp() });

  const parentId = await ensureFolderPath(drive, config.sharedDriveId, buildDriveFolderPath(data), folderCache);
  const name = buildDriveNameForDoc(data);
  const file = bucket.file(data.storagePath);

  const created = await uploadToDrive({
    drive,
    name,
    parentId,
    mimeType: data.mimeType || `video/${extensionFromMimeType(data.mimeType)}`,
    stream: file.createReadStream(),
    sizeBytes: data.sizeBytes,
  });

  // update(), never set(): this worker bypasses security rules, and dropping a field the
  // client-side hasOnly() check expects would make every later client write fail.
  await ref.update({
    driveStatus: 'moved',
    driveFileId: created.id,
    driveUrl: created.webViewLink ?? '',
    movedToDriveAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection('packingVideoAudit').add({
    videoId: data.videoId,
    action: 'drive_moved',
    actorUid: 'system-drive-worker',
    actorEmail: config.workerEmail ?? 'drive-worker@system',
    at: FieldValue.serverTimestamp(),
    deviceId: '',
    detail: { driveFileId: created.id },
  });

  return { videoId: data.videoId, driveUrl: created.webViewLink };
}

async function movePending({ drive, bucket, db, config }) {
  const snapshot = await db.collection('packingVideos')
    .where('driveStatus', '==', 'pending')
    .where('status', '==', 'uploaded')
    .orderBy('uploadedAt', 'asc')
    .limit(BATCH_SIZE)
    .get();

  if (snapshot.empty) {
    console.log('No packing videos waiting to move.');
    return 0;
  }

  const folderCache = new Map();
  let moved = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    try {
      const result = await moveOne({ drive, bucket, db, config, doc, folderCache });
      moved += 1;
      console.log(`Moved ${result.videoId} -> ${result.driveUrl}`);
    } catch (error) {
      // `driveAttempts` has to be persisted, not just computed: it used to be read off a field
      // nothing ever wrote, so it was 1 on every pass, MAX_DRIVE_ATTEMPTS was unreachable and
      // no clip ever reached needs_review. A failure also has to go back to 'pending' to be
      // picked up again — the query only looks at 'pending', so 'failed' was already terminal
      // and the retry budget existed on paper only.
      // Give up automatically rather than retrying a broken file forever; a human decides
      // what to do with it from the dashboard.
      const plan = planDriveRetry(data);
      console.warn(
        `Move failed for ${data.videoId} (attempt ${plan.driveAttempts}/${MAX_DRIVE_ATTEMPTS}):`,
        error.message,
      );
      await doc.ref.update({
        driveAttempts: plan.driveAttempts,
        driveStatus: plan.driveStatus,
        lastErrorCode: 'PACKING_VIDEO_DRIVE_MOVE_FAILED',
        status: plan.status,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  // The count is logged rather than assumed: a capped batch that reports nothing reads as
  // "everything is done" when it is not.
  if (snapshot.size === BATCH_SIZE) {
    console.log(`Batch cap of ${BATCH_SIZE} reached; more videos are still waiting.`);
  }
  return moved;
}

/**
 * Second pass: delete Storage objects that have been in Drive long enough.
 *
 * Deliberately not immediate. A week of overlap leaves time to notice a file that will not
 * play, and keeps the current week's dashboard playback fast. A bucket lifecycle rule on the
 * `packing-videos/` prefix should back this up, so a worker that silently dies cannot run up
 * an unbounded storage bill.
 *
 * A purged document is moved to `driveStatus: 'purged'` so it leaves this query. Clearing only
 * `storagePath` left it as `moved`, and since the batch reads the OLDEST `moved` documents the
 * same already-purged 25 filled every later pass — `isStorageDeletable` skipped them all, so
 * after the first sweep no Storage object was ever deleted again and the bucket grew without
 * bound at roughly 12 GB a day.
 */
async function purgeMovedObjects({ bucket, db }) {
  const snapshot = await db.collection('packingVideos')
    .where('driveStatus', '==', 'moved')
    .orderBy('movedToDriveAt', 'asc')
    .limit(BATCH_SIZE)
    .get();

  let deleted = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const action = planStoragePurge({ ...data, movedToDriveAt: toDate(data.movedToDriveAt) });
    if (action === 'wait' || action === 'skip') continue;
    // 'retire': purged before this fix, so there is no object left to delete — but it still has
    // to leave the queue or it blocks the head of the batch for ever.
    if (action === 'retire') {
      await doc.ref.update({ driveStatus: 'purged', updatedAt: FieldValue.serverTimestamp() });
      continue;
    }
    try {
      await bucket.file(data.storagePath).delete({ ignoreNotFound: true });
      await doc.ref.update({
        driveStatus: 'purged',
        storagePath: '',
        storageUrl: '',
        updatedAt: FieldValue.serverTimestamp(),
      });
      deleted += 1;
    } catch (error) {
      console.warn(`Could not delete ${data.storagePath}:`, error.message);
    }
  }

  if (deleted) console.log(`Deleted ${deleted} Storage objects past retention.`);
  return deleted;
}

export function parseArgs(argv, { defaultIntervalSeconds = DEFAULT_INTERVAL_SECONDS } = {}) {
  const args = argv.slice(2);
  const flag = args.indexOf('--interval');
  const raw = flag >= 0 ? Number(args[flag + 1]) : defaultIntervalSeconds;

  if (!Number.isFinite(raw) || raw < MIN_INTERVAL_SECONDS) {
    throw new Error(`--interval must be a number of seconds >= ${MIN_INTERVAL_SECONDS}`);
  }

  return { watch: args.includes('--watch'), intervalSeconds: raw };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPass({ drive, bucket, db, config }) {
  const moved = await movePending({ drive, bucket, db, config });
  await purgeMovedObjects({ bucket, db });
  return moved;
}

async function main() {
  const { watch, intervalSeconds } = parseArgs(process.argv);
  const config = await loadConfig();
  if (!config.sharedDriveId) throw new Error('config.sharedDriveId is required');

  // Fail loudly if the shared field list drifts; the client can only write these keys.
  if (!PACKING_VIDEO_FIELDS.includes('driveStatus')) {
    throw new Error('packingVideoModel field list is missing driveStatus');
  }

  const { db, bucket } = initFirebase(config);
  const drive = await initDrive(config);

  if (!watch) {
    const moved = await runPass({ drive, bucket, db, config });
    console.log(`Done. Moved ${moved} video(s).`);
    return;
  }

  // Watch mode exists so a finished clip reaches the archive within about a minute instead of
  // waiting for the next scheduled run. A pass that throws must not end the loop: a transient
  // Drive 5xx or a dropped network link would otherwise stop archiving silently until somebody
  // noticed, which is exactly the failure the retention rule cannot absorb.
  console.log(`Watching for packing videos every ${intervalSeconds}s. Ctrl+C to stop.`);
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; console.log('\nStopping after the current pass...'); });
  process.on('SIGTERM', () => { stopping = true; });

  while (!stopping) {
    try {
      const moved = await runPass({ drive, bucket, db, config });
      if (moved) console.log(`Moved ${moved} video(s).`);
    } catch (error) {
      console.error('Pass failed, retrying next interval:', error.message);
    }
    if (stopping) break;
    await delay(intervalSeconds * 1000);
  }
}

// Only run when executed directly, so the tests can import parseArgs without starting a worker.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
