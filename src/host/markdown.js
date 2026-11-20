import { extname } from 'node:path';
import { pdfBody } from './pdf.js';
import { imageMarkdown } from './vision.js';

const images = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
export function fileKind(name) {
  const extension = extname(name).slice(1).toLowerCase();
  if (['md', 'markdown'].includes(extension)) return 'md';
  if (['txt', 'text', 'log'].includes(extension)) return 'txt';
  if (extension === 'pdf' || Object.hasOwn(images, extension)) return extension;
  throw new Error('Choose Markdown, plain text, a PDF, PNG, JPEG, or WebP.');
}

function heading(title) {
  return '# ' + title.replace(/[\r\n]+/g, ' ').replace(/([\\*_[\]#<>])/g, '\\$1');
}
function clean(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}
function withHeading(title, body) {
  return heading(title) + '\n\n' + body + (body.endsWith('\n') ? '' : '\n');
}

export async function toMarkdown(doc, settings, ask, signal, pageProgress = () => {}) {
  signal.throwIfAborted();
  if (doc.kind === 'md' || doc.kind === 'txt') {
    const text = clean(new TextDecoder('utf-8', { fatal: true }).decode(doc.source));
    if (!text.trim()) throw new Error('This document contains no text.');
    return doc.kind === 'md' ? text : withHeading(doc.title, text);
  }
  if (images[doc.kind]) {
    const body = await imageMarkdown(
      { bytes: doc.source, mime: images[doc.kind], name: doc.title },
      '',
      true,
      settings,
      ask,
      signal,
    );
    return withHeading(doc.title, body);
  }

  return withHeading(doc.title, await pdfBody(doc, settings, ask, signal, pageProgress));
}

// Keep exact offsets into the downloadable Markdown. Prefer a paragraph or
// line break, and avoid splitting a UTF-16 surrogate pair at a hard limit.
export function passageRanges(text, maxLength = 1400) {
  const ranges = [];
  for (let start = 0; start < text.length; ) {
    let end = Math.min(text.length, start + maxLength);
    if (end < text.length) {
      const floor = start + Math.floor(maxLength / 2);
      for (const boundary of ['\n\n', '\n', ' ']) {
        const split = text.lastIndexOf(boundary, end - boundary.length);
        if (split >= floor) {
          end = split + boundary.length;
          break;
        }
      }
      if (text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--;
    }
    if (text.slice(start, end).trim()) ranges.push({ start, end });
    start = end;
  }
  return ranges;
}
