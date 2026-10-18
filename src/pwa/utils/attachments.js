// Turns a picked/pasted File into what a user_message frame carries (see
// src/session/attachments.ts for the daemon half).
//
// Photos are downscaled here, before they cross the tailnet: an iPhone photo is 4–12 MB and
// often HEIC, while Claude downsamples anything past ~1568px on its long edge anyway, so the
// extra pixels are pure upload cost — and the API refuses an image over 5 MB outright.
// Re-encoding through a canvas also turns HEIC (which the API doesn't take) into JPEG.

export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_EDGE = 1568;
const PREVIEW_EDGE = 160;
// Sent as-is when already small enough; base64 of 3.75 MB is the API's 5 MB image cap.
const PASSTHROUGH_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const PASSTHROUGH_MAX_BYTES = 3.75 * 1024 * 1024;

function readBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1));
    r.onerror = () => reject(r.error ?? new Error('could not read file'));
    r.readAsDataURL(blob);
  });
}

// `from-image` applies the EXIF orientation, or a portrait iPhone photo arrives sideways.
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawScaled(source, maxEdge) {
  const w = source.width, h = source.height;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  // JPEG has no alpha: without a backdrop a transparent PNG's background turns black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode image'))), type, quality);
  });
}

async function prepareImage(file) {
  const bitmap = await decode(file);
  const fits = Math.max(bitmap.width, bitmap.height) <= MAX_EDGE;
  const passthrough = fits && PASSTHROUGH_TYPES.has(file.type) && file.size <= PASSTHROUGH_MAX_BYTES;
  const blob = passthrough ? file : await canvasBlob(drawScaled(bitmap, MAX_EDGE), 'image/jpeg', 0.85);
  const preview = drawScaled(bitmap, PREVIEW_EDGE).toDataURL('image/jpeg', 0.7);
  bitmap.close?.();
  return { kind: 'image', name: file.name || 'photo.jpg', mediaType: passthrough ? file.type : 'image/jpeg', data: await readBase64(blob), preview };
}

// Rejects with a message fit to show the user.
export async function prepareAttachment(file) {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name || 'File'} is larger than 20 MB`);
  if (file.type.startsWith('image/')) {
    // A format this browser can't decode (HEIC in desktop Chrome) still goes — as a file.
    try { return await prepareImage(file); } catch { /* send as a file */ }
  }
  return {
    kind: 'file',
    name: file.name || 'file',
    mediaType: file.type || 'application/octet-stream',
    data: await readBase64(file),
    preview: null,
  };
}

// What crosses the wire — the preview is for this device only.
export function wireAttachment({ kind, name, mediaType, data }) {
  return { kind, name, mediaType, data };
}

// `[Attached file: /…/uploads/<sid>/<ts>-<i>-report.pdf (application/pdf, 1.2 MB)]` — the
// line the daemon appends for a non-image file. Pulled back out so the transcript shows a
// chip rather than the raw path.
const ATTACHED_FILE_LINE = /^\[Attached file: (.+) \(([^,()]+), ([^()]+)\)\]$/gm;

export function splitAttachedFiles(text) {
  const files = [];
  const rest = text.replace(ATTACHED_FILE_LINE, (_m, path, mediaType, size) => {
    files.push({ name: String(path).split('/').pop().replace(/^\d+-\d+-/, ''), mediaType, size });
    return '';
  }).trim();
  return { text: rest, files };
}
