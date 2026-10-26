// src/knowledge/pdf-parse-worker.mjs
import { parentPort } from "node:worker_threads";

// src/knowledge/pdf-text-layout.mjs
function joinPdfTextItems(items) {
  let text = "", previous;
  for (const item of items) {
    if (typeof item.str !== "string" || !item.str) continue;
    const x = item.transform?.[4] ?? 0, y = item.transform?.[5] ?? 0;
    const height = Math.abs(item.height || item.transform?.[3] || 10);
    if (previous) {
      const tolerance = Math.max(0.5, Math.min(height, previous.height) * 0.35);
      const newLine = Math.abs(y - previous.y) > tolerance || x < previous.x - tolerance;
      if (newLine) text += "\n";
      else {
        const gap = x - previous.right;
        if (gap > Math.min(height, previous.height) * 0.12 && !/\s$/.test(text) && !/^\s/.test(item.str)) text += " ";
      }
    }
    text += item.str;
    previous = { x, y, height, right: x + (Number.isFinite(item.width) ? item.width : 0) };
  }
  return text.replace(/\u00ad\s*\n\s*/g, "").replace(/\u00ad/g, "").replace(/[ \t]+\n/g, "\n");
}

// src/knowledge/pdf-parse-worker.mjs
process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.warn(`[dsh-knowledge] pdf-parse worker ignored a stray rejection: ${message.slice(0, 200)}`);
});
var queue = Promise.resolve();
parentPort?.on("message", (message) => {
  if (message?.type === "shutdown") {
    process.exit(0);
    return;
  }
  const { id, data } = message;
  queue = queue.then(async () => {
    try {
      const mod = await import("pdf-parse");
      const pages = [], scanned = [];
      const result = await mod.default(Uint8Array.from(data), { pagerender: async (page) => {
        const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
        const text = joinPdfTextItems(content.items);
        pages[page.pageNumber - 1] = text;
        if (!text.trim()) scanned.push(page.pageNumber);
        return text;
      } });
      parentPort?.postMessage({ id, ok: true, text: typeof result?.text === "string" ? result.text : "", pages: scanned.length ? Array.from({ length: result.numpages }, (_, index) => pages[index] ?? "") : void 0, scanned });
    } catch (error) {
      parentPort?.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
});
//# sourceMappingURL=pdf-parse-worker.mjs.map
