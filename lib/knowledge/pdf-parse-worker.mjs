// src/knowledge/pdf-parse-worker.mjs
import { parentPort } from "node:worker_threads";
process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.warn(`[dsh-knowledge] pdf-parse worker ignored a stray rejection: ${message.slice(0, 200)}`);
});
parentPort?.on("message", (message) => {
  if (message?.type === "shutdown") {
    process.exit(0);
    return;
  }
  const { id, data } = message;
  void (async () => {
    try {
      const mod = await import("pdf-parse");
      const pages = [], scanned = [];
      const result = await mod.default(Buffer.from(data), { pagerender: async (page) => {
        const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
        let text = "", lastY;
        for (const item of content.items) {
          if (lastY !== void 0 && lastY !== item.transform[5]) text += "\n";
          text += item.str;
          lastY = item.transform[5];
        }
        pages[page.pageNumber - 1] = text;
        if (!text.trim()) {
          const operators = await page.getOperatorList();
          if (operators.fnArray.some((op) => [82, 83, 84, 85, 86, 87, 88, 89].includes(op))) scanned.push(page.pageNumber);
        }
        return text;
      } });
      parentPort?.postMessage({ id, ok: true, text: typeof result?.text === "string" ? result.text : "", pages: Array.from({ length: result.numpages }, (_, index) => pages[index] ?? ""), scanned });
    } catch (error) {
      parentPort?.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();
});
//# sourceMappingURL=pdf-parse-worker.mjs.map
