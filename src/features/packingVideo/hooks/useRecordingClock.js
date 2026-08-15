import { useEffect, useState } from 'react';

import { formatDuration } from '../../../services/packingVideoFormat.js';

/**
 * Elapsed recording time.
 *
 * Recomputed from `startedAt` on every tick rather than incremented, so the display stays
 * correct even when the tab is backgrounded and timers are throttled.
 */
export function useRecordingClock(startedAt) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!startedAt) {
      setElapsedMs(0);
      return undefined;
    }

    const tick = () => setElapsedMs(Date.now() - new Date(startedAt).getTime());
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [startedAt]);

  return { elapsedMs, label: formatDuration(elapsedMs) };
}
