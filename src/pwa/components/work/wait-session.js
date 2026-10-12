import { workApi } from '../../net/work.js';
import { openSession } from '../../app-bridge.js';
import { openCwdPickerSheet } from '../cwd-picker.js';

// The label for a meta.wait's session button, or null when the step offers none: a parked
// wait can start one, and once one exists it stays reachable until the job's teardown closes it.
export function waitSessionLabel(job, s) {
  if (s?.type !== 'action' || s.action !== 'meta.wait') return null;
  if (job.state === 'done' || job.state === 'abandoned') return null;
  if (s.manualSession) return s.state === 'waiting' ? 'Continue session' : 'View session';
  return s.state === 'waiting' && !s.cancelled && !s.failure ? 'Open session' : null;
}

// A wait with no workspace has nowhere to run until the user picks one.
export function openWaitStepSession(job, s) {
  if (!s.manualSession && s.workspace?.kind === 'none') {
    openCwdPickerSheet(undefined, { onPick: (cwd) => void open(job, s, cwd) });
    return;
  }
  void open(job, s);
}

async function open(job, s, cwd) {
  try {
    const opened = await workApi.openWaitSession(job.id, s.id, cwd);
    openSession({ id: opened.sessionId, cwd: opened.cwd, fromTicketId: job.id });
  } catch (err) {
    alert(`Open session failed: ${err?.message ?? err}`);
  }
}
