export const CONTEXT_WINDOWS = { _default: 200_000 };

// `claude-<family>-<major>[-<minor>][-<yyyymmdd>][1m]`. The minor is one or two digits so a
// date snapshot (`claude-opus-4-20250514`) isn't read as version 4.20250514.
const MODEL_ID = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i;

// Only covers the stretch before a session's first `result`: Claude Code reports each model's
// real window there (modelUsage[].contextWindow) and the slice keeps it — see dispatch.js.
// Through the 4.x line Claude Code ran 200k unless you picked the [1m] variant; from the 5.x
// generation on, 1M is the default. A table keyed on exact ids went stale the day Opus 5.5
// shipped and showed it at 200k, so this is a rule over the family and generation instead.
export function lookupContextWindow(modelId) {
  const m = typeof modelId === 'string' ? modelId.match(MODEL_ID) : null;
  if (!m) return CONTEXT_WINDOWS._default;
  if (m[4]) return 1_000_000;
  const family = m[1].toLowerCase();
  if (family === 'fable' || family === 'mythos') return 1_000_000;
  return Number(m[2]) >= 5 ? 1_000_000 : CONTEXT_WINDOWS._default;
}

// `claude-opus-4-7[1m]` → "Opus 4.7 (1M)". statusLine's display_name doesn't
// fire in --print mode, so we derive from the model id.
export function prettyModelName(id) {
  if (typeof id !== 'string' || !id) return null;
  const m = id.match(MODEL_ID);
  if (!m) return id;
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  const version = m[3] ? `${m[2]}.${m[3]}` : m[2];
  return `${family} ${version}${m[4] ? ' (1M)' : ''}`;
}

// Derive context-window usage + model label for one session, statusline-first
// (authoritative from claude's statusLine hook) with a message_start lastUsage
// fallback. Pure: callers pass the slice's statusline/lastUsage and, for the
// fallback, the project's context-window total + whether to retag the model as
// 1M (the API strips the [1m] suffix, so we re-add it for the display name).
export function contextUsage(statusline, lastUsage, { fallbackTotal, retagTo1M } = {}) {
  const total0 = fallbackTotal || CONTEXT_WINDOWS._default;
  const slCtx = statusline?.contextWindow;
  const slCur = slCtx?.current_usage;
  if (slCtx && typeof slCtx.context_window_size === 'number') {
    const input = slCur?.input_tokens ?? 0;
    const output = slCur?.output_tokens ?? 0;
    const cacheCreate = slCur?.cache_creation_input_tokens ?? 0;
    const cacheRead = slCur?.cache_read_input_tokens ?? 0;
    const total = slCtx.context_window_size;
    const used = (typeof slCtx.total_input_tokens === 'number' && typeof slCtx.total_output_tokens === 'number')
      ? slCtx.total_input_tokens + slCtx.total_output_tokens
      : input + output + cacheCreate + cacheRead;
    const pct = (typeof slCtx.used_percentage === 'number')
      ? slCtx.used_percentage
      : (total > 0 ? (used / total) * 100 : 0);
    return {
      known: true, used, total, pct,
      breakdown: { input, output, cacheCreate, cacheRead },
      modelLabel: statusline.model?.id ?? statusline.model?.display_name ?? null,
      modelDisplay: statusline.model?.display_name ?? null,
    };
  }
  if (lastUsage) {
    const { inputTokens = 0, outputTokens = 0, cacheCreate = 0, cacheRead = 0 } = lastUsage;
    const used = inputTokens + outputTokens + cacheCreate + cacheRead;
    const raw = lastUsage.model ?? null;
    const retagged = (retagTo1M && typeof raw === 'string' && !raw.endsWith('[1m]')) ? `${raw}[1m]` : raw;
    return {
      known: true, used, total: total0, pct: total0 > 0 ? (used / total0) * 100 : 0,
      breakdown: { input: inputTokens, output: outputTokens, cacheCreate, cacheRead },
      modelLabel: raw, modelDisplay: prettyModelName(retagged),
    };
  }
  return {
    known: false, used: 0, total: total0, pct: 0,
    breakdown: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
    modelLabel: null, modelDisplay: null,
  };
}
