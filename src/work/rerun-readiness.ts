import type { RunGh } from '../integrations/gh-cli.js';

export interface RunSnapshot {
  headBranch?: string;
  status?: string;
  conclusion?: string;
  attempt?: number;
}

// One automatic retry per run: a check that fails again on its rerun is no longer plausibly a flake.
export function rerunBlocker(run: RunSnapshot, branch: string): string | undefined {
  if (run.headBranch !== branch) return `run is on ${run.headBranch ?? 'an unknown branch'}, not ${branch}`;
  if (run.status !== 'completed') return `run is still ${run.status ?? 'in an unknown state'}`;
  if (run.conclusion === 'success') return 'run already succeeded';
  if (run.attempt !== 1) return `run is already on attempt ${run.attempt ?? 'unknown'}`;
  return undefined;
}

export async function readRerunReadiness(runGh: RunGh, cwd: string, runId: string, branch: string): Promise<string | undefined> {
  const run = JSON.parse(await runGh(cwd, [
    'run', 'view', runId, '--json', 'headBranch,status,conclusion,attempt',
  ])) as RunSnapshot;
  return rerunBlocker(run, branch);
}
