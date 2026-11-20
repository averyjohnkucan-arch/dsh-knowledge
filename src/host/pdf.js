import { imageMarkdown } from './vision.js';

// Render only the requested page region. This also preserves the orientation
// of images that the PDF places with a rotation or reflection.
function renderRegion(pdf, page, rect, name) {
  const [left, top, right, bottom] = rect;
  const scale = Math.min(2.5, 2400 / Math.max(right - left, bottom - top));
  const width = Math.max(1, Math.ceil((right - left) * scale));
  const height = Math.max(1, Math.ceil((bottom - top) * scale));
  const pixmap = new pdf.Pixmap(pdf.ColorSpace.DeviceRGB, [0, 0, width, height], false);
  try {
    pixmap.clear(255);
    const device = new pdf.DrawDevice(pdf.Matrix.identity, pixmap);
    try {
      page.run(device, [scale, 0, 0, scale, -left * scale, -top * scale]);
      device.close();
    } finally {
      device.destroy();
    }
    return { bytes: pixmap.asPNG(), mime: 'image/png', name };
  } finally {
    pixmap.destroy();
  }
}

async function readPage(pdf, page, number, settings, ask, signal) {
  const bounds = page.getBounds();
  const layout = page.toStructuredText('preserve-images,vectors');
  const images = [];
  let hasDrawing = false,
    text;
  try {
    text = layout.asText().trim();
    layout.walk({
      onImageBlock(rect, _transform, image) {
        image.destroy();
        const visible = [
          Math.max(rect[0], bounds[0]),
          Math.max(rect[1], bounds[1]),
          Math.min(rect[2], bounds[2]),
          Math.min(rect[3], bounds[3]),
        ];
        if (visible[2] - visible[0] >= 12 && visible[3] - visible[1] >= 12) images.push(visible);
      },
      onVector(rect) {
        if (Math.max(rect[2] - rect[0], rect[3] - rect[1]) >= 16) hasDrawing = true;
      },
    });
  } finally {
    layout.destroy();
  }
  const graphics = hasDrawing || images.length > 0;
  if (!text && !graphics) return '';
  if (!text && !settings.ocrModel && !settings.descriptionModel) {
    throw new Error(
      'Page ' + number + ' needs a vision model. Choose an OCR or description model and retry.',
    );
  }

  // Native text can be just a page number on an otherwise scanned page.
  // Cropping each embedded image keeps OCR from repeating the native text.
  if (text && settings.ocrModel && images.length) {
    const extra = [];
    for (let i = 0; i < images.length; i++) {
      signal.throwIfAborted();
      const image = renderRegion(
        pdf,
        page,
        images[i],
        'page-' + number + '-image-' + (i + 1) + '.png',
      );
      const words = (await ask(settings.ocrModel, 'ocr', image, signal)).trim();
      if (words && words !== 'NO_TEXT' && !text.includes(words) && !extra.includes(words))
        extra.push(words);
    }
    if (extra.length) text += '\n\n### Text in images\n\n' + extra.join('\n\n');
  }
  if (!text || (graphics && settings.descriptionModel)) {
    signal.throwIfAborted();
    const image = renderRegion(pdf, page, bounds, 'page-' + number + '.png');
    text = await imageMarkdown(image, text, graphics, settings, ask, signal);
  }
  return '## Page ' + number + '\n\n' + text;
}

export async function pdfBody(doc, settings, ask, signal, pageProgress) {
  const pdf = await import('mupdf');
  const source = pdf.Document.openDocument(doc.source, 'application/pdf');
  const sections = [];
  try {
    const count = source.countPages();
    for (let i = 0; i < count; i++) {
      signal.throwIfAborted();
      pageProgress(i + 1, count);
      const page = source.loadPage(i);
      try {
        const section = await readPage(pdf, page, i + 1, settings, ask, signal);
        if (section) sections.push(section);
      } finally {
        page.destroy();
      }
    }
  } finally {
    source.destroy();
  }
  if (!sections.length) throw new Error('This PDF contains no readable pages.');
  return sections.join('\n\n');
}
