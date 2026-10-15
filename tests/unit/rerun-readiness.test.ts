import { describe, it, expect } from 'vitest';
import { rerunBlocker, type RunSnapshot } from '../../src/work/rerun-readiness.js';

const failed: RunSnapshot = { headBranch: 'deps/bump-ws', status: 'completed', conclusion: 'failure', attempt: 1 };

describe('rerunBlocker', () => {
  it('clears a finished, failed first attempt on the step branch', () => {
    expect(rerunBlocker(failed, 'deps/bump-ws')).toBeUndefined();
    expect(rerunBlocker({ ...failed, conclusion: 'cancelled' }, 'deps/bump-ws')).toBeUndefined();
  });

  it.each<[string, RunSnapshot, string]>([
    ['another branch', { ...failed, headBranch: 'main' }, 'on main'],
    ['a run still going', { ...failed, status: 'in_progress', conclusion: '' }, 'in_progress'],
    ['a green run', { ...failed, conclusion: 'success' }, 'succeeded'],
    ['a run already retried', { ...failed, attempt: 2 }, 'attempt 2'],
    ['a run whose attempt gh did not report', { ...failed, attempt: undefined }, 'attempt unknown'],
  ])('blocks %s', (_name, run, reason) => {
    expect(rerunBlocker(run, 'deps/bump-ws')).toContain(reason);
  });
});
