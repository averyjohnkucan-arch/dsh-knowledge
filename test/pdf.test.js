import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pdf from 'mupdf';
import { toMarkdown } from '../src/host/markdown.js';
import { defaults } from '../src/host/store.js';

function samplePdf(pages) {
  const document = new pdf.PDFDocument();
  const font = new pdf.Font('Helvetica');
  const pixmap = new pdf.Pixmap(pdf.ColorSpace.DeviceRGB, [0, 0, 50, 50], false);
  pixmap.clear(140);
  const image = new pdf.Image(pixmap);
  const fontRef = document.addSimpleFont(font);
  const imageRef = document.addImage(image);
  const resources = { Font: { F1: fontRef }, XObject: { Scan: imageRef } };
  try {
    for (const content of pages) {
      const page = document.addPage([0, 0, 250, 140], 0, resources, content);
      document.insertPage(-1, page);
      page.destroy();
    }
    const data = document.saveToBuffer();
    try {
      return Buffer.from(data.asUint8Array());
    } finally {
      data.destroy();
    }
  } finally {
    imageRef.destroy();
    fontRef.destroy();
    image.destroy();
    pixmap.destroy();
    font.destroy();
    document.destroy();
  }
}

test('mixed PDFs preserve page numbers, transcribe scans and describe embedded or vector graphics', async () => {
  const source = samplePdf([
    'BT /F1 14 Tf 12 100 Td (Field report) Tj ET',
    '',
    'q 140 0 0 85 15 15 cm /Scan Do Q',
    'BT /F1 12 Tf 12 115 Td (Rainfall chart) Tj ET 0 0 1 rg 20 10 30 50 re f',
    'BT /F1 12 Tf 10 120 Td (Appendix) Tj ET q 140 0 0 85 15 15 cm /Scan Do Q',
  ]);
  const calls = [];
  const ask = async (model, role, img) => {
    assert.equal(img.mime, 'image/png');
    assert.deepEqual(Array.from(img.bytes.slice(0, 4)), [137, 80, 78, 71]);
    calls.push([model, role, img.name]);
    return role === 'ocr' ? 'A scanned page' : 'The chart shows a blue bar.';
  };
  const md = await toMarkdown(
    { title: 'Field notes.pdf', kind: 'pdf', source },
    { ...defaults, ocrModel: 'p/scan', descriptionModel: 'p/figure' },
    ask,
    new AbortController().signal,
  );
  assert.deepEqual(calls, [
    ['p/scan', 'ocr', 'page-3.png'],
    ['p/figure', 'description', 'page-3.png'],
    ['p/figure', 'description', 'page-4.png'],
    ['p/scan', 'ocr', 'page-5-image-1.png'],
    ['p/figure', 'description', 'page-5.png'],
  ]);
  assert.match(md, /## Page 5\n\nAppendix\n\n### Text in images\n\nA scanned page/);
  assert.match(md, /## Page 1\n\nField report/);
  assert.doesNotMatch(md, /Page 2/);
  assert.match(md, /## Page 3\n\nA scanned page/);
  assert.match(md, /## Page 4\n\nRainfall chart\n\n### Image and chart description/);
});

test('empty PDFs and image-only PDFs without a selected reader return an actionable import error', async () => {
  const doc = (contents) => ({ title: 'Notes', kind: 'pdf', source: samplePdf([contents]) });
  const signal = new AbortController().signal;
  await assert.rejects(toMarkdown(doc(''), defaults, assert.fail, signal), /no readable pages/);
  await assert.rejects(
    toMarkdown(doc('q 140 0 0 85 15 15 cm /Scan Do Q'), defaults, assert.fail, signal),
    /Page 1 needs a vision model/,
  );
});
