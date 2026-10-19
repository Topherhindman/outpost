// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
// @ts-expect-error PWA modules are plain JS; tests import them at runtime.
import { dispatchSession, installDispatchDeps } from '../../src/pwa/ws/dispatch.js';
// @ts-expect-error PWA modules are plain JS.
import { sessions } from '../../src/pwa/state/sessions.js';

const SID = 'sess-ctx';

// Trimmed from a real `claude -p` 2.1.302 result: --print mode never fires statusLine, so
// modelUsage is the only place the session's real context window is stated.
function result(modelUsage: Record<string, unknown>) {
  return { type: 'result', subtype: 'success', modelUsage };
}

beforeEach(() => {
  sessions.set({ view: 'session', currentSessionId: SID, maxTranscriptLines: 500, sessionsById: new Map() });
  sessions.ensureSlice(SID);
  installDispatchDeps({ state: {}, stopThinking() {}, renderSession() {} });
});

describe('result → slice.contextWindow', () => {
  it('records the window claude reports for the session model', () => {
    dispatchSession(result({ 'claude-opus-5-5': { contextWindow: 1000000, maxOutputTokens: 128000 } }), SID);
    expect(sessions.getSlice(SID).contextWindow).toBe(1000000);
  });

  it("prefers the session's own model over a subagent's", () => {
    sessions.for(SID).setLastUsage({ model: 'claude-opus-5-5' });
    dispatchSession(result({
      'claude-haiku-4-5-20251001': { contextWindow: 200000 },
      'claude-opus-5-5': { contextWindow: 1000000 },
    }), SID);
    expect(sessions.getSlice(SID).contextWindow).toBe(1000000);
  });

  it('leaves the slice alone when the result carries no window', () => {
    dispatchSession(result({ 'claude-opus-5-5': { inputTokens: 3 } }), SID);
    dispatchSession({ type: 'result', subtype: 'success' }, SID);
    expect(sessions.getSlice(SID).contextWindow).toBeNull();
  });
});
