// @vitest-environment node
import { describe, it, expect } from 'vitest';
// @ts-expect-error plain JS
import { contextUsage, prettyModelName, lookupContextWindow } from '../../src/pwa/utils/context-usage.js';

describe('contextUsage', () => {
  it('uses statusline when present (authoritative)', () => {
    const sl = { model: { id: 'claude-opus-4-8', display_name: 'Opus 4.8' },
      contextWindow: { context_window_size: 200000, total_input_tokens: 30000, total_output_tokens: 10000 } };
    const r = contextUsage(sl, null, { fallbackTotal: 999, retagTo1M: false });
    expect(r.known).toBe(true);
    expect(r.total).toBe(200000);
    expect(r.used).toBe(40000);
    expect(Math.round(r.pct)).toBe(20);
    expect(r.modelLabel).toBe('claude-opus-4-8');
    expect(r.modelDisplay).toBe('Opus 4.8');
  });

  it('falls back to lastUsage with the given fallbackTotal', () => {
    const lu = { inputTokens: 100, outputTokens: 50, cacheCreate: 0, cacheRead: 0, model: 'claude-opus-4-8' };
    const r = contextUsage(null, lu, { fallbackTotal: 200000, retagTo1M: false });
    expect(r.known).toBe(true);
    expect(r.used).toBe(150);
    expect(r.total).toBe(200000);
    expect(r.modelLabel).toBe('claude-opus-4-8');
    expect(r.modelDisplay).toBe('Opus 4.8');
  });

  it('retags the fallback model to [1m] when retagTo1M', () => {
    const lu = { inputTokens: 1, outputTokens: 1, cacheCreate: 0, cacheRead: 0, model: 'claude-opus-4-8' };
    const r = contextUsage(null, lu, { fallbackTotal: 1000000, retagTo1M: true });
    expect(r.modelDisplay).toBe('Opus 4.8 (1M)');
  });

  it('returns known:false with zeros when neither source is present', () => {
    const r = contextUsage(null, null, { fallbackTotal: 200000, retagTo1M: false });
    expect(r.known).toBe(false);
    expect(r.used).toBe(0);
    expect(r.total).toBe(200000);
    expect(r.modelDisplay).toBeNull();
  });

  it('prettyModelName reads every family, with or without a minor version or date', () => {
    expect(prettyModelName('claude-opus-4-8[1m]')).toBe('Opus 4.8 (1M)');
    expect(prettyModelName('claude-opus-5-5')).toBe('Opus 5.5');
    expect(prettyModelName('claude-opus-5')).toBe('Opus 5');
    expect(prettyModelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(prettyModelName('claude-fable-5-1')).toBe('Fable 5.1');
  });

  it('lookupContextWindow: 1M from the 5.x generation on, 200k before it unless [1m]', () => {
    expect(lookupContextWindow('claude-opus-5-5')).toBe(1000000);
    expect(lookupContextWindow('claude-sonnet-5-5')).toBe(1000000);
    expect(lookupContextWindow('claude-haiku-5-5')).toBe(1000000);
    expect(lookupContextWindow('claude-opus-5')).toBe(1000000);
    expect(lookupContextWindow('claude-fable-5-1')).toBe(1000000);
    expect(lookupContextWindow('claude-opus-4-7[1m]')).toBe(1000000);
    expect(lookupContextWindow('claude-opus-4-7')).toBe(200000);
    expect(lookupContextWindow('claude-sonnet-4-6')).toBe(200000);
    expect(lookupContextWindow('claude-haiku-4-5-20251001')).toBe(200000);
    // A date snapshot's yyyymmdd is not a minor version.
    expect(lookupContextWindow('claude-opus-4-20250514')).toBe(200000);
    expect(lookupContextWindow('unknown')).toBe(200000);
    expect(lookupContextWindow(null)).toBe(200000);
  });
});
