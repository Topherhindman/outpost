// The composer's pending photos and files: the 📎 picker, paste and drop all feed one list
// per session, shown as a tray of thumbnails above the composer, and send() takes it.
//
// Kept per session in a module-level map, like composerDraft, so backgrounding a tab
// doesn't drop what the user attached. Not persisted — a reload starts clean.
import { escapeHtml } from '../../util.js';
import { MAX_ATTACHMENTS, prepareAttachment } from '../../utils/attachments.js';

const pendingBySession = new Map();
let nextId = 0;

// Something ready to send — what turns Send on with an empty composer.
export function hasReadyAttachments(sessionId) {
  const list = pendingBySession.get(sessionId) ?? [];
  return list.length > 0 && !list.some((a) => a.preparing);
}

function trayHtml(list, error) {
  const items = list.map((a) => {
    const body = a.preparing
      ? `<span class="sv-attachment-busy" aria-label="Preparing ${escapeHtml(a.name)}">…</span>`
      : a.kind === 'image'
        ? `<img src="${escapeHtml(a.preview)}" alt="${escapeHtml(a.name)}">`
        : `<span class="sv-attachment-file">📄 ${escapeHtml(a.name)}</span>`;
    return `<span class="sv-attachment">${body}` +
      `<button type="button" class="sv-attachment-remove" data-remove="${a.id}" aria-label="Remove ${escapeHtml(a.name)}">×</button></span>`;
  });
  const err = error ? `<span class="sv-attachment-error" role="alert">${escapeHtml(error)}</span>` : '';
  return items.join('') + err;
}

// `onChange` lets the composer repaint Send/Stop when the list changes. Every listener sits
// on mount-owned DOM, so it goes away with the mount — nothing to unwire.
export function wireAttachments(dom, sessionId, onChange) {
  let error = '';
  const list = () => pendingBySession.get(sessionId) ?? [];
  const render = () => {
    dom.attachments.innerHTML = trayHtml(list(), error);
    dom.attachments.hidden = list().length === 0 && !error;
  };
  const set = (next) => {
    if (next.length) pendingBySession.set(sessionId, next);
    else pendingBySession.delete(sessionId);
    render();
    onChange();
  };

  const add = (files) => {
    error = '';
    const room = MAX_ATTACHMENTS - list().length;
    if (files.length > room) error = `Up to ${MAX_ATTACHMENTS} attachments per message.`;
    for (const file of files.slice(0, Math.max(0, room))) {
      const id = String(++nextId);
      set([...list(), { id, name: file.name || 'file', preparing: true }]);
      prepareAttachment(file).then(
        (ready) => set(list().map((a) => (a.id === id ? { id, ...ready } : a))),
        (e) => { error = e.message; set(list().filter((a) => a.id !== id)); },
      );
    }
    render();
  };

  const onPick = () => {
    add([...dom.attachInput.files]);
    dom.attachInput.value = ''; // so picking the same photo again still fires `change`
  };
  const onAttachClick = () => dom.attachInput.click();
  const onTrayClick = (e) => {
    const id = e.target.closest('[data-remove]')?.dataset.remove;
    if (!id) return;
    error = '';
    set(list().filter((a) => a.id !== id));
  };
  // The composer is contenteditable: left alone, a pasted image lands in it as an <img> that
  // innerText then silently drops on send.
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    add(files);
  };
  const onDragOver = (e) => {
    if ([...(e.dataTransfer?.types ?? [])].includes('Files')) e.preventDefault();
  };
  const onDrop = (e) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    add(files);
  };

  dom.attach.addEventListener('click', onAttachClick);
  dom.attachInput.addEventListener('change', onPick);
  dom.attachments.addEventListener('click', onTrayClick);
  dom.composer.addEventListener('paste', onPaste);
  dom.composerWrap.addEventListener('dragover', onDragOver);
  dom.composerWrap.addEventListener('drop', onDrop);
  render();

  return {
    // Still decoding/downscaling — sending now would drop it.
    busy: () => list().some((a) => a.preparing),
    take: () => {
      const taken = list();
      error = '';
      set([]);
      return taken;
    },
  };
}
