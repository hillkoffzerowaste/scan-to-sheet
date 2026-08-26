// The workspace recreates the queue when its device identity changes. Reading the ref at the
// hand-off boundary avoids sending a new recording to the disposed queue from the old render.
export function kickCurrentPackingQueue(queueRef) {
  return queueRef?.current?.kick?.();
}

export function retryCurrentPackingQueue(queueRef, videoId) {
  return queueRef?.current?.retry?.(videoId);
}
