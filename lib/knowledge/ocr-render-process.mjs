// src/knowledge/ocr-render-process.ts
import * as engine from "mupdf";
var credits = /* @__PURE__ */ new Set();
var active = false;
var outstanding = 0;
process.on("disconnect", () => process.exit(0));
process.on("message", (request) => {
  if (request?.type === "ack") {
    outstanding--;
    for (const wake of credits) wake();
    credits.clear();
    return;
  }
  if (active || request?.type !== "render") return;
  active = true;
  void (async () => {
    let document;
    try {
      document = engine.Document.openDocument(new Uint8Array(request.bytes), "application/pdf");
      const count = document.countPages(), selected = request.pages ? new Set(request.pages) : void 0;
      if (selected && [...selected].some((page) => !Number.isInteger(page) || page < 1 || page > count)) throw Error("OCR selected page is outside the document");
      if ((selected?.size ?? count) > request.maxPages) throw Error(`OCR page limit exceeded (${count} pages, limit ${request.maxPages})`);
      let total = 0;
      for (let index = 0; index < count; index++) {
        if (selected && !selected.has(index + 1)) continue;
        while (outstanding >= request.window) await new Promise((resolve) => credits.add(resolve));
        const page = document.loadPage(index);
        let png;
        try {
          const bounds = page.getBounds(), width = bounds[2] - bounds[0], height = bounds[3] - bounds[1], area = width * height;
          if (![width, height, area].every((value) => Number.isFinite(value) && value > 0)) throw Error("OCR page dimensions are invalid");
          const preferred = area * 9 * 4 <= request.pageBytes ? 3 : 1;
          let scale = Math.min(preferred, Math.sqrt(request.pageBytes / (4 * area)) * 0.999, request.maxDimension / width, request.maxDimension / height);
          for (let attempt = 0; attempt < 4; attempt++) {
            let raster;
            try {
              raster = page.toPixmap(engine.Matrix.scale(scale, scale), engine.ColorSpace.DeviceRGB, false);
              png = Buffer.from(raster.asPNG());
              break;
            } catch (error) {
              if (attempt === 3 || !/malloc|memory|allocat/i.test(String(error))) throw error;
              scale /= 2;
            } finally {
              raster?.destroy();
            }
          }
        } finally {
          page.destroy();
        }
        if (!png?.length) throw Error(`OCR page ${index + 1} produced an empty raster`);
        total += png.length;
        if (total > request.totalBytes) throw Error("OCR raster byte budget exceeded; split the PDF");
        outstanding++;
        process.send?.({ type: "page", page: index + 1, png });
      }
      while (outstanding) await new Promise((resolve) => credits.add(resolve));
      process.send?.({ type: "done" });
    } catch (error) {
      process.send?.({ type: "error", message: String(error).slice(0, 1e3) });
    } finally {
      document?.destroy();
    }
  })();
});
//# sourceMappingURL=ocr-render-process.mjs.map
