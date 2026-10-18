// Photos and files sent with a message from the PWA composer.
//
// An image rides inline as an `image` content block — the same shape claude's own CLI sends
// when you paste one, and `claude -p --input-format=stream-json` accepts it unchanged. Any
// other file is written to disk and its path appended to the message, so the model opens it
// with Read: that works for every type Read understands (PDFs included) without Outpost
// having to know them, and leaves the file somewhere the model's other tools can reach too.
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface Attachment {
  kind: 'image' | 'file';
  name: string;
  mediaType: string;
  data: string; // base64
}

export type UserContent = string | Array<
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'text'; text: string }
>;

export const MAX_ATTACHMENTS = 10;
// Raw bytes per attachment. The PWA downscales photos long before this; it bounds what one
// file costs the WebSocket frame and the disk.
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
// What the Messages API accepts in an image block. Anything else is sent as a file.
export const IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

// Throws with a message fit to show the user. An absent field is no attachments.
export function parseAttachments(raw: unknown): Attachment[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error('attachments must be a list');
  if (raw.length > MAX_ATTACHMENTS) throw new Error(`at most ${MAX_ATTACHMENTS} attachments per message`);
  return raw.map((a, i) => {
    const { kind, name, mediaType, data } = (a ?? {}) as Record<string, unknown>;
    const label = typeof name === 'string' && name ? name : `attachment ${i + 1}`;
    if (kind !== 'image' && kind !== 'file') throw new Error(`${label}: unknown attachment kind`);
    if (typeof data !== 'string' || !data || !BASE64.test(data)) throw new Error(`${label}: not base64 data`);
    if (Math.floor(data.length * 3 / 4) > MAX_ATTACHMENT_BYTES) throw new Error(`${label}: larger than 20 MB`);
    const type = typeof mediaType === 'string' ? mediaType.toLowerCase() : '';
    if (kind === 'image' && !IMAGE_MEDIA_TYPES.has(type)) throw new Error(`${label}: unsupported image type ${type || '(none)'}`);
    return { kind, name: label, mediaType: type || 'application/octet-stream', data };
  });
}

// The name only ever becomes the last path segment, and never a dotfile or a traversal.
export function safeFileName(name: string): string {
  const cleaned = basename(name).replace(/[^\w.\- ]+/g, '_').replace(/^[.\s]+/, '').trim().slice(0, 120);
  return cleaned || 'file';
}

// Returns where the file landed. Files are per-session so one session's uploads never shadow
// another's, and timestamped so two `IMG_0001.jpeg`s sent a minute apart both survive.
export function makeUploadSaver(uploadsRoot: string, sessionId: string, now = Date.now): (a: Attachment, index: number) => string {
  if (!/^[\w-]+$/.test(sessionId)) throw new Error('invalid session id');
  const dir = join(uploadsRoot, sessionId);
  return (a, index) => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${now()}-${index}-${safeFileName(a.name)}`);
    writeFileSync(path, Buffer.from(a.data, 'base64'), { mode: 0o600 });
    return path;
  };
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function buildUserContent(text: string, attachments: Attachment[], save: (a: Attachment, index: number) => string): UserContent {
  if (attachments.length === 0) return text;
  const fileLines = attachments.flatMap((a, i) => {
    if (a.kind !== 'file') return [];
    const path = save(a, i);
    return [`[Attached file: ${path} (${a.mediaType}, ${fmtBytes(Buffer.byteLength(a.data, 'base64'))})]`];
  });
  const fullText = [text, ...fileLines].filter(Boolean).join('\n\n');
  const images = attachments.filter((a) => a.kind === 'image');
  if (images.length === 0) return fullText;
  return [
    ...images.map((a) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: a.mediaType, data: a.data } })),
    // The API rejects an empty text block, so a photo sent on its own carries none.
    ...(fullText ? [{ type: 'text' as const, text: fullText }] : []),
  ];
}
