/**
 * pdf-parse worker — pdf-parse v1 bundles pdf.js v1.10, whose failure path
 * leaks a rejection: `getDocument` throws before the local `doc` is ever
 * assigned, so the library's unawaited `doc.destroy()` never runs and the
 * half-built fake worker leaves a promise rejecting with nobody attached.
 * Node 22 escalates that stray rejection to a process-level unhandled
 * rejection, so importing a scanned or corrupt PDF would surface it in the DSH
 * host process (and failed CI on Node 22.19).
 *
 * This thread owns that failure domain, exactly as ocr-worker owns
 * Tesseract.js's `process.nextTick` rethrow and embed-process owns onnxruntime
 * crashes: the stray rejection is recorded here and never reaches the host.
 * The parse result itself is unaffected — a document pdf-parse cannot read
 * still reports a clean failure to the caller, which then falls through to
 * pdfjs-dist layout extraction, OCR, and anydoc.
 *
 * Plain JavaScript rather than TypeScript on purpose: this file is started by
 * `new Worker(...)`, so Node's own loader reads it — not a transform step — and
 * the same relative URL must resolve in the source tree (vitest runs against
 * `src/`) and in the built `lib/` bundle alike.
 *
 * Protocol (JSON over parentPort):
 *   main → worker:  { id, data: Uint8Array }
 *                    { type: 'shutdown' }
 *   worker → main:  { id, ok: true, text } | { id, ok: false, error }
 * @module dsh-knowledge/knowledge/pdf-parse-worker
 */

import { parentPort } from 'node:worker_threads'

// Installing a listener keeps this thread alive through a library-internal
// stray rejection instead of letting Node's default policy terminate it. The
// message stays bounded and prefixed so the condition is diagnosable rather
// than silently swallowed.
process.on('unhandledRejection', reason => {
  const message = reason instanceof Error ? reason.message : String(reason)
  console.warn(`[dsh-knowledge] pdf-parse worker ignored a stray rejection: ${message.slice(0, 200)}`)
})

parentPort?.on('message', message => {
  if (message?.type === 'shutdown') {
    process.exit(0)
    return
  }
  const { id, data } = message
  void (async () => {
    try {
      // pdf-parse v1 is CommonJS; the default export is the parser function.
      const mod = await import('pdf-parse')
      const pages = [], scanned = []
      const result = await mod.default(Buffer.from(data), { pagerender: async page => {
        const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
        let text = '', lastY
        for (const item of content.items) {
          if (lastY !== undefined && lastY !== item.transform[5]) text += '\n'
          text += item.str; lastY = item.transform[5]
        }
        pages[page.pageNumber - 1] = text
        // Text extraction must not decode images. pdf.js 1.10's operator-list
        // path uses browser Image globals and is expensive on scanned PDFs.
        // Textless pages (including blank pages) are cheap OCR candidates.
        if (!text.trim()) scanned.push(page.pageNumber)
        return text
      } })
      parentPort?.postMessage({ id, ok: true, text: typeof result?.text === 'string' ? result.text : '', pages: Array.from({ length: result.numpages }, (_, index) => pages[index] ?? ''), scanned })
    } catch (error) {
      parentPort?.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })()
})
