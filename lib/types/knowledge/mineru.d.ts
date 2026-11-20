/**
 * Remote document processor — MinerU (Cherry's `mineru` file processor).
 * Used for scanned / complex-layout PDFs when configured: the file is
 * uploaded to the MinerU API (batch task → PUT upload → poll → download the
 * result zip), and the extracted Markdown replaces the local parse output.
 * Falls back to the local pipeline on any API failure.
 *
 * API shape mirrors Cherry's `processors/mineru/*` (file-urls/batch +
 * extract-results/batch + zip download).
 * @module dsh-knowledge/knowledge/mineru
 */
export interface MineruSettings {
    apiKey: string;
    apiHost: string;
}
/**
 * Extract a PDF's text through the MinerU API. Returns the Markdown text;
 * throws on API/processing failure so the caller can fall back to local.
 * An external `signal` (e.g. the document was deleted) aborts the polling
 * loop and the in-flight requests so a paid remote batch is not left running.
 */
export declare function extractPdfWithMineru(bytes: Uint8Array, fileName: string, settings: MineruSettings, signal?: AbortSignal): Promise<string>;
//# sourceMappingURL=mineru.d.ts.map