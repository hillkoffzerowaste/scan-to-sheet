import { normalizePackingTracking } from '../../../services/packingVideoModel.js';

/**
 * The recording screen as a pure reducer.
 *
 * Side effects are declared, not performed: every returned state carries an `effects` array
 * that the hook executes. That keeps the whole flow — including the awkward "scan the next
 * label while still recording" path — testable under `node --test` with no camera, no
 * Firestore and no DOM.
 *
 * Upload state deliberately lives outside this machine. Uploading is an app-level queue, so
 * the packer can start the next parcel while the previous clip is still going up.
 */

export const PACKING_STATE = {
  setup: 'setup',
  idle: 'idle',
  searching: 'searching',
  notFound: 'notFound',
  duplicatePrompt: 'duplicatePrompt',
  starting: 'starting',
  recording: 'recording',
  finalizing: 'finalizing',
  handedOff: 'handedOff',
  cameraError: 'cameraError',
};

export const RECORD_OUTCOME = {
  completed: 'completed',
  cancelled: 'cancelled',
  discarded: 'discarded',
  interrupted: 'interrupted',
  autostop: 'autostop',
};

export const initialPackingState = Object.freeze({
  status: PACKING_STATE.setup,
  station: '',
  packer: '',
  tracking: '',
  order: null,
  history: [],
  mode: null,
  pendingScan: '',
  outcome: null,
  startedAt: null,
  errorCode: '',
  effects: [],
});

/** True while a scan must be ignored — the machine is mid-lookup, mid-stop, or waiting on a choice. */
export function shouldBlockScan(state) {
  return [
    PACKING_STATE.setup,
    PACKING_STATE.searching,
    PACKING_STATE.duplicatePrompt,
    PACKING_STATE.starting,
    PACKING_STATE.finalizing,
    PACKING_STATE.cameraError,
  ].includes(state.status);
}

export function isRecordingState(state) {
  return state.status === PACKING_STATE.recording;
}

const next = (state, patch, effects = []) => ({ ...state, ...patch, effects });
const stay = (state) => ({ ...state, effects: [] });

function beginLookup(state, tracking) {
  return next(
    state,
    {
      status: PACKING_STATE.searching,
      tracking,
      order: null,
      history: [],
      mode: null,
      pendingScan: '',
      errorCode: '',
    },
    [{ type: 'lookupOrder', tracking }],
  );
}

export function reducePackingSession(state = initialPackingState, event) {
  const { status } = state;

  switch (event?.type) {
    case 'START_SESSION': {
      const station = String(event.station ?? '').trim();
      const packer = String(event.packer ?? '').trim();
      if (!station || !packer) {
        return next(state, { errorCode: 'PACKING_VIDEO_SETUP_INCOMPLETE' }, [
          { type: 'showError', code: 'PACKING_VIDEO_SETUP_INCOMPLETE' },
        ]);
      }
      return next(state, { status: PACKING_STATE.idle, station, packer, errorCode: '' }, [
        { type: 'persistPreferences', station, packer },
        { type: 'probeCamera' },
        { type: 'focusScanInput' },
      ]);
    }

    case 'CLOSE_SESSION': {
      // Never drop a clip on the floor just because someone left the mode.
      if (status === PACKING_STATE.recording) {
        return next(state, { status: PACKING_STATE.finalizing, outcome: RECORD_OUTCOME.interrupted }, [
          { type: 'stopRecorder', outcome: RECORD_OUTCOME.interrupted },
        ]);
      }
      return next(state, { ...initialPackingState, station: state.station, packer: state.packer }, [
        { type: 'releaseCamera' },
      ]);
    }

    case 'SCAN': {
      const tracking = String(event.tracking ?? '').trim();
      if (!tracking) return stay(state);

      if (status === PACKING_STATE.recording) {
        // Re-reading the label already being recorded is a bounce, not a new job.
        if (normalizePackingTracking(tracking) === normalizePackingTracking(state.tracking)) {
          return stay(state);
        }
        return next(
          state,
          {
            status: PACKING_STATE.finalizing,
            outcome: RECORD_OUTCOME.completed,
            pendingScan: tracking,
          },
          [{ type: 'stopRecorder', outcome: RECORD_OUTCOME.completed }],
        );
      }

      if (shouldBlockScan(state)) return stay(state);
      return beginLookup(state, tracking);
    }

    case 'LOOKUP_OK': {
      if (status !== PACKING_STATE.searching) return stay(state);
      const history = Array.isArray(event.history) ? event.history : [];
      if (history.length > 0) {
        return next(state, { status: PACKING_STATE.duplicatePrompt, order: event.order ?? null, history }, []);
      }
      return next(state, { status: PACKING_STATE.starting, order: event.order ?? null, mode: 'new' }, [
        { type: 'startRecording', mode: 'new', tracking: state.tracking, order: event.order ?? null },
      ]);
    }

    case 'LOOKUP_EMPTY': {
      if (status !== PACKING_STATE.searching) return stay(state);
      // Spec: an unknown tracking number must never start the camera.
      return next(state, { status: PACKING_STATE.notFound, order: null, errorCode: 'PACKING_VIDEO_ORDER_NOT_FOUND' }, [
        { type: 'playTone', tone: 'error' },
        { type: 'focusScanInput' },
      ]);
    }

    case 'LOOKUP_ERROR': {
      if (status !== PACKING_STATE.searching) return stay(state);
      const code = event.code || 'PACKING_VIDEO_LOOKUP_FAILED';
      return next(state, { status: PACKING_STATE.notFound, order: null, errorCode: code }, [
        { type: 'showError', code },
        { type: 'playTone', tone: 'error' },
        { type: 'focusScanInput' },
      ]);
    }

    case 'DUP_CONTINUE':
    case 'DUP_RERECORD': {
      if (status !== PACKING_STATE.duplicatePrompt) return stay(state);
      const mode = event.type === 'DUP_CONTINUE' ? 'continue' : 'rerecord';
      return next(state, { status: PACKING_STATE.starting, mode }, [
        {
          type: 'startRecording',
          mode,
          tracking: state.tracking,
          order: state.order,
          linkTo: state.history[0]?.videoId ?? '',
        },
      ]);
    }

    case 'DUP_CANCEL': {
      if (status !== PACKING_STATE.duplicatePrompt) return stay(state);
      return next(state, { status: PACKING_STATE.idle, tracking: '', order: null, history: [], mode: null }, [
        { type: 'focusScanInput' },
      ]);
    }

    case 'RECORDER_READY': {
      if (status !== PACKING_STATE.starting) return stay(state);
      return next(state, { status: PACKING_STATE.recording, startedAt: event.startedAt ?? null, errorCode: '' }, [
        { type: 'startClock', startedAt: event.startedAt ?? null },
      ]);
    }

    case 'CAMERA_FAILED': {
      const code = event.code || 'PACKING_VIDEO_CAMERA_UNAVAILABLE';
      return next(state, { status: PACKING_STATE.cameraError, errorCode: code }, [
        { type: 'showError', code },
      ]);
    }

    case 'PACK_DONE':
    case 'CANCEL':
    case 'RESTART':
    case 'CAMERA_LOST':
    case 'RECORDER_ERROR':
    case 'AUTO_STOP_LIMIT': {
      if (status !== PACKING_STATE.recording) return stay(state);
      const outcome = {
        PACK_DONE: RECORD_OUTCOME.completed,
        CANCEL: RECORD_OUTCOME.cancelled,
        RESTART: RECORD_OUTCOME.discarded,
        CAMERA_LOST: RECORD_OUTCOME.interrupted,
        RECORDER_ERROR: RECORD_OUTCOME.interrupted,
        AUTO_STOP_LIMIT: RECORD_OUTCOME.autostop,
      }[event.type];
      return next(
        state,
        {
          status: PACKING_STATE.finalizing,
          outcome,
          // "บันทึกใหม่" keeps the same parcel: re-scan it once the old clip is safely stored.
          pendingScan: event.type === 'RESTART' ? state.tracking : state.pendingScan,
        },
        [{ type: 'stopRecorder', outcome }],
      );
    }

    case 'RECORDER_STOPPED': {
      if (status !== PACKING_STATE.finalizing) return stay(state);
      const handOff = {
        type: 'handOff',
        outcome: state.outcome,
        blob: event.blob ?? null,
        // Only an explicit false marks a clip as missing chunks; an event that says nothing
        // about it is a whole recording, which is what every existing caller means.
        complete: event.complete !== false,
        mimeType: event.mimeType ?? '',
        durationMs: event.durationMs ?? 0,
        finishedAt: event.finishedAt ?? null,
      };
      if (state.pendingScan) {
        // Hand off without awaiting, then reopen the queued parcel straight away.
        return next(
          { ...state, pendingScan: '' },
          { status: PACKING_STATE.searching, tracking: state.pendingScan, order: null, history: [], mode: null },
          [handOff, { type: 'lookupOrder', tracking: state.pendingScan }],
        );
      }
      return next(
        state,
        { status: PACKING_STATE.idle, tracking: '', order: null, history: [], mode: null, outcome: null, startedAt: null },
        [handOff, { type: 'focusScanInput' }],
      );
    }

    case 'RECORDER_STOP_FAILED': {
      if (status !== PACKING_STATE.finalizing) return stay(state);
      // Chunks are already in IndexedDB, so recovery on next boot still has the footage.
      return next(
        state,
        { status: PACKING_STATE.idle, tracking: '', order: null, history: [], pendingScan: '', errorCode: 'PACKING_VIDEO_FINALIZE_FAILED' },
        [{ type: 'showError', code: 'PACKING_VIDEO_FINALIZE_FAILED' }, { type: 'focusScanInput' }],
      );
    }

    case 'RETRY': {
      if (status !== PACKING_STATE.cameraError) return stay(state);
      return next(state, { status: PACKING_STATE.starting, errorCode: '' }, [
        { type: 'startRecording', mode: state.mode ?? 'new', tracking: state.tracking, order: state.order },
      ]);
    }

    default:
      return stay(state);
  }
}
