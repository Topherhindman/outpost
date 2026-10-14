import { describe, it, expect } from 'vitest';
import { planStepView } from '../../src/work/envelope.js';
import type { ActionStep, OrchestratedStep } from '../../src/work/work-types.js';

const base = { description: 'd', goal: 'g', createdAt: 1, updatedAt: 1 };

function orchestrated(over: Partial<OrchestratedStep> = {}): OrchestratedStep {
  return {
    ...base, id: 'o', type: 'orchestrated', title: 'pr step', controller: 'code.orchestrate-pr',
    workspace: { kind: 'writable', repoCwd: '/r', branch: 'b' }, state: 'resolved',
    inputs: { approach: 'x'.repeat(5000) },
    memo: 'merged after pass 2',
    artifacts: { spec: `# Spec\n${'body '.repeat(5000)}`, review: 'pass 2 — clean\ndetails' },
    pr: { prUrl: 'https://github.com/o/r/pull/1', prState: 'merged', comments: [], ciChecks: [] },
    dispatches: [{ id: 'd', action: 'code.review-diff', brief: 'b', status: 'done', attempts: 1, output: 'y'.repeat(5000) }],
    inbox: [], drafts: [], roundsSpent: 40, consecutiveSelfRounds: 0,
    ...over,
  };
}

describe('planStepView', () => {
  it('reduces a finished controller step to what a planner can act on', () => {
    const v = planStepView(orchestrated());
    expect(v).toEqual({
      id: 'o', type: 'orchestrated', title: 'pr step', description: 'd', state: 'resolved', goal: 'g',
      workspace: { kind: 'writable', repoCwd: '/r', branch: 'b' },
      controller: 'code.orchestrate-pr', memo: 'merged after pass 2',
      pr: { prUrl: 'https://github.com/o/r/pull/1', prState: 'merged' },
      artifacts: { spec: '# Spec', review: 'pass 2 — clean' },
    });
  });

  it('keeps the inputs of a step that can still be amended', () => {
    expect(planStepView(orchestrated({ state: 'running' })).inputs).toEqual({ approach: 'x'.repeat(5000) });
    expect(planStepView(orchestrated({ state: 'running', cancelled: true })).inputs).toBeUndefined();
  });

  it('caps a single-line artifact', () => {
    const v = planStepView(orchestrated({ artifacts: { implementation: 'z'.repeat(1000) } }));
    expect(v.artifacts!.implementation).toBe(`${'z'.repeat(200)}…`);
  });

  it("keeps an action step's output", () => {
    const step: ActionStep = {
      ...base, id: 'a', type: 'action', title: 'investigate', action: 'read.investigate',
      workspace: { kind: 'none' }, state: 'resolved', output: 'found it', forwardOutput: true,
    };
    expect(planStepView(step)).toMatchObject({ action: 'read.investigate', output: 'found it', forwardOutput: true });
  });
});
