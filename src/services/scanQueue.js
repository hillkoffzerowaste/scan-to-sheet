const normalizePendingCode = (code) => String(code ?? '').trim().toUpperCase();

function pendingKey(job) {
  const code = normalizePendingCode(job?.code);
  const context = job?.context ?? {};
  const scope = [context.activeTab, context.courier].filter(Boolean).join('::');
  return scope ? `${scope}::${code}` : code;
}

export function createScanQueue({ process, onStateChange = () => {}, maxSize = 100 }) {
  if (typeof process !== 'function') {
    throw new TypeError('createScanQueue requires a process function');
  }

  const pending = [];
  const pendingCodes = new Set();
  let processing = null;
  let completed = 0;
  let failed = 0;
  let results = [];
  let disposed = false;
  let drainPromise = null;

  function getSnapshot() {
    return {
      pending: pending.map((job) => ({ ...job })),
      processing: processing ? { ...processing } : null,
      completed,
      failed,
      lastResult: results[0] ?? null,
      results: results.map((result) => ({ ...result })),
    };
  }

  function notify() {
    if (!disposed) onStateChange(getSnapshot());
  }

  async function drain() {
    while (!disposed && pending.length > 0) {
      const job = pending.shift();
      processing = job;
      notify();

      let queueResult;
      try {
        const result = await process(job);
        queueResult = { status: 'success', job, result };
      } catch (error) {
        failed += 1;
        queueResult = {
          status: 'error',
          job,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      } finally {
        completed += 1;
        pendingCodes.delete(pendingKey(job));
        processing = null;
      }

      results = [queueResult, ...results].slice(0, 20);
      notify();
    }
    drainPromise = null;
  }

  function enqueue(job) {
    if (disposed) return { accepted: false, reason: 'disposed', job: null };

    const normalizedCode = normalizePendingCode(job?.code);
    if (!normalizedCode) return { accepted: false, reason: 'empty', job: null };
    if (pendingCodes.has(pendingKey(job))) {
      return { accepted: false, reason: 'duplicate_pending', job: null };
    }
    if (pending.length + (processing ? 1 : 0) >= maxSize) {
      return { accepted: false, reason: 'queue_full', job: null };
    }

    const queuedJob = { ...job, code: String(job.code).trim() };
    pending.push(queuedJob);
    pendingCodes.add(pendingKey(queuedJob));
    notify();
    if (!drainPromise) drainPromise = drain();
    return { accepted: true, reason: null, job: queuedJob };
  }

  function dispose() {
    disposed = true;
    pending.length = 0;
    pendingCodes.clear();
  }

  return { enqueue, getSnapshot, dispose };
}
