// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
// @ts-expect-error PWA modules are plain JS; tests import them at runtime.
import { dispatchSession, installDispatchDeps } from '../../src/pwa/ws/dispatch.js';
// @ts-expect-error PWA modules are plain JS.
import { sessions } from '../../src/pwa/state/sessions.js';
// @ts-expect-error PWA modules are plain JS.
import { sessionContextWindow } from '../../src/pwa/utils/context-usage.js';

const SID = 'sess-ctx';

// Trimmed from a real `claude -p` 2.1.302 result
function result(modelUsage: Record<string, unknown>) {
  return { type: 'result', subtype: 'success', modelUsage };
}

const window = () => sessionContextWindow(sessions.getSlice(SID));

beforeEach(() => {
  sessions.set({ view: 'session', currentSessionId: SID, maxTranscriptLines: 500, sessionsById: new Map() });
  sessions.ensureSlice(SID);
  installDispatchDeps({ state: {}, stopThinking() {}, renderSession() {} });
});

describe('result → session context window', () => {
  it("resolves to the session model's window, not a subagent's", () => {
    sessions.for(SID).setLastUsage({ model: 'claude-opus-5-5' });
    dispatchSession(result({
      'claude-haiku-4-5-20251001': { contextWindow: 200000 },
      'claude-opus-5-5': { contextWindow: 1000000 },
    }), SID);
    expect(window()).toBe(1000000);
  });

  it('matches a [1m] modelUsage key to the bare id the API reports', () => {
    sessions.for(SID).setLastUsage({ model: 'claude-opus-4-7' });
    dispatchSession(result({
      'claude-haiku-4-5-20251001': { contextWindow: 200000 },
      'claude-opus-4-7[1m]': { contextWindow: 1000000 },
    }), SID);
    expect(window()).toBe(1000000);
  });

  it('drops a stale window once the session switches model', () => {
    sessions.for(SID).setLastUsage({ model: 'claude-opus-5-5' });
    dispatchSession(result({ 'claude-opus-5-5': { contextWindow: 1000000 } }), SID);
    sessions.for(SID).setLastUsage({ model: 'claude-sonnet-4-6' });
    expect(window()).toBeNull();
  });

  it('leaves the slice alone when the result carries no window', () => {
    sessions.for(SID).setLastUsage({ model: 'claude-opus-5-5' });
    dispatchSession(result({ 'claude-opus-5-5': { inputTokens: 3 } }), SID);
    dispatchSession({ type: 'result', subtype: 'success' }, SID);
    expect(window()).toBeNull();
  });
});
