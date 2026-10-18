import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildUserContent,
  makeUploadSaver,
  parseAttachments,
  safeFileName,
  MAX_ATTACHMENTS,
} from '../../src/session/attachments.js';
import { handleSessionMessage, type SessionMessageDeps } from '../../src/ws/client-messages.js';

const b64 = (s: string) => Buffer.from(s).toString('base64');
const png = { kind: 'image', name: 'IMG_0001.png', mediaType: 'image/png', data: b64('png-bytes') };
const pdf = { kind: 'file', name: 'report.pdf', mediaType: 'application/pdf', data: b64('%PDF-1.7') };

describe('parseAttachments', () => {
  it('treats an absent field as no attachments', () => {
    expect(parseAttachments(undefined)).toEqual([]);
    expect(parseAttachments(null)).toEqual([]);
  });

  it('accepts images and files', () => {
    expect(parseAttachments([png, pdf]).map((a) => a.kind)).toEqual(['image', 'file']);
  });

  it.each([
    ['a non-list', { kind: 'image' }, /must be a list/],
    ['an unknown kind', [{ ...png, kind: 'video' }], /unknown attachment kind/],
    ['non-base64 data', [{ ...png, data: 'not base64!' }], /not base64/],
    ['an image type the API rejects', [{ ...png, mediaType: 'image/heic' }], /unsupported image type image\/heic/],
    ['too many', Array.from({ length: MAX_ATTACHMENTS + 1 }, () => png), /at most 10/],
  ])('refuses %s', (_label, raw, error) => {
    expect(() => parseAttachments(raw)).toThrow(error);
  });
});

describe('safeFileName', () => {
  it('keeps the name a single, visible path segment', () => {
    expect(safeFileName('../../.ssh/id_rsa')).toBe('id_rsa');
    expect(safeFileName('.env')).toBe('env');
    expect(safeFileName('my photo (1).jpg')).toBe('my photo _1_.jpg');
    expect(safeFileName('')).toBe('file');
  });
});

describe('buildUserContent', () => {
  it('leaves a message without attachments as a plain string', () => {
    expect(buildUserContent('hi', [], () => '')).toBe('hi');
  });

  it('puts images inline, ahead of the text', () => {
    const content = buildUserContent('what is this?', parseAttachments([png]), () => '');
    expect(content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.data } },
      { type: 'text', text: 'what is this?' },
    ]);
  });

  it('sends a photo on its own without an empty text block', () => {
    expect(buildUserContent('', parseAttachments([png]), () => '')).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.data } },
    ]);
  });

  it('saves a file and points the model at its path', () => {
    const save = vi.fn(() => '/up/s1/1-1-report.pdf');
    const content = buildUserContent('summarize this', parseAttachments([png, pdf]), save);
    expect(save).toHaveBeenCalledOnce();
    expect(content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.data } },
      { type: 'text', text: 'summarize this\n\n[Attached file: /up/s1/1-1-report.pdf (application/pdf, 8 B)]' },
    ]);
  });
});

describe('makeUploadSaver', () => {
  it('writes the bytes under the session, private to the user', () => {
    const root = mkdtempSync(join(tmpdir(), 'uploads-'));
    const path = makeUploadSaver(root, 'sess-1', () => 1700000000000)(parseAttachments([pdf])[0]!, 0);
    expect(path).toBe(join(root, 'sess-1', '1700000000000-0-report.pdf'));
    expect(readFileSync(path, 'utf8')).toBe('%PDF-1.7');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('refuses a session id that could leave the uploads root', () => {
    expect(() => makeUploadSaver('/tmp/x', '../etc')).toThrow(/invalid session id/);
  });
});

describe('user_message with attachments', () => {
  const deps = (uploadsRoot?: string) => ({
    queue: { decide: vi.fn() },
    manager: { send: vi.fn(), interrupt: vi.fn(), broadcast: vi.fn() },
    modes: { set: vi.fn() },
    uploadsRoot,
  }) satisfies SessionMessageDeps;
  const frame = (body: object) => Buffer.from(JSON.stringify({ type: 'user_message', ...body }));

  it('sends images as content blocks', () => {
    const d = deps();
    handleSessionMessage(frame({ content: 'look', attachments: [png] }), 's1', d);
    expect(d.manager.send).toHaveBeenCalledWith('s1', { type: 'user', message: { role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.data } },
      { type: 'text', text: 'look' },
    ] } });
  });

  it('writes a file under uploadsRoot and sends its path', () => {
    const root = mkdtempSync(join(tmpdir(), 'uploads-'));
    const d = deps(root);
    handleSessionMessage(frame({ content: 'read this', attachments: [pdf] }), 's1', d);
    const content = d.manager.send.mock.calls[0]![1].message.content as string;
    const path = /\[Attached file: (\S+) /.exec(content)![1]!;
    expect(path.startsWith(join(root, 's1') + '/')).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('%PDF-1.7');
  });

  it('refuses the whole message, and says why, when one attachment is bad', () => {
    const d = deps();
    handleSessionMessage(frame({ content: 'look', attachments: [png, { ...png, mediaType: 'image/heic' }] }), 's1', d);
    expect(d.manager.send).not.toHaveBeenCalled();
    expect(d.manager.broadcast).toHaveBeenCalledWith('s1', expect.objectContaining({
      type: 'daemon_error', message: expect.stringContaining('unsupported image type'),
    }));
  });

  it('refuses a file when there is nowhere to put it', () => {
    const d = deps();
    handleSessionMessage(frame({ content: '', attachments: [pdf] }), 's1', d);
    expect(d.manager.send).not.toHaveBeenCalled();
    expect(d.manager.broadcast).toHaveBeenCalledWith('s1', expect.objectContaining({ type: 'daemon_error' }));
  });
});
