import { workApi } from '../../net/work.js';
import { openSession } from '../../app-bridge.js';
import { sessions } from '../../state/sessions.js';
import { openCwdPickerSheet } from '../cwd-picker.js';

// The user's session on a parked wait, which the step renders inline as a full session view.
export function inlineWaitSession(s) {
  if (s?.type !== 'action' || s.action !== 'meta.wait') return null;
  return s.state === 'waiting' && !s.cancelled && !s.failure ? s.manualSession ?? null : null;
}

// The label for a meta.wait's session button, or null when the step offers none: a parked
// wait can start one, and once the wait settles it stays reachable until the job's teardown closes it.
export function waitSessionLabel(job, s) {
  if (s?.type !== 'action' || s.action !== 'meta.wait') return null;
  if (job.state === 'done' || job.state === 'abandoned') return null;
  if (inlineWaitSession(s)) return null;
  if (s.manualSession) return 'View session';
  return s.state === 'waiting' && !s.cancelled && !s.failure ? 'Open session' : null;
}

// A wait with no workspace has nowhere to run until the user picks one.
export function openWaitStepSession(job, s) {
  if (s.manualSession) {
    openSession({ id: s.manualSession.id, cwd: s.manualSession.cwd, fromTicketId: job.id });
    return;
  }
  if (s.workspace?.kind === 'none') {
    openCwdPickerSheet(undefined, { onPick: (cwd) => void create(job, s, cwd) });
    return;
  }
  void create(job, s);
}

// The step's repaint mounts the session once manualSession lands on it.
async function create(job, s, cwd) {
  try {
    const opened = await workApi.openWaitSession(job.id, s.id, cwd);
    sessions.ensureSlice(opened.sessionId, { cwd: opened.cwd, fromTicketId: job.id });
    sessions.for(opened.sessionId).setPendingDefaultPush(true);
  } catch (err) {
    alert(`Open session failed: ${err?.message ?? err}`);
  }
}
