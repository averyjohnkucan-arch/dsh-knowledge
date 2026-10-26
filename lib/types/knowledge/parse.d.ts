/**
 * Document parsing. Text-like formats decode directly; HTML is stripped to
 * text; PDF and DOCX use optional parsers; PPTX / XLSX / EPUB are extracted
 * from their zip container with jszip. Every parser loads lazily so a missing
 * dependency degrades to a clear error instead of breaking plugin load.
 * @module dsh-knowledge/knowledge/parse
 */
/**
 * The formats a knowledge import accepts (Cherry's `knowledgeSupportedFileExts`
 * plus json/log, which we decode as plain text). Anything else — binaries,
 * images, archives — is rejected at add time instead of being decoded into
 * garbage text (Cherry's directory scan skips unsupported extensions silently).
 */
export declare const SUPPORTED_DOCUMENT_EXTENSIONS: readonly ["txt", "md", "markdown", "mdx", "csv", "html", "htm", "json", "log", "pdf", "docx", "doc", "pptx", "ppt", "xlsx", "xls", "epub"];
/** Lowercased extension of a file name ('' when none). */
export declare function extensionOf(fileName: string): string;
/** Return the parsed text of a document buffer, dispatching on extension. */
export declare function parseDocumentBuffer(buffer: Uint8Array, fileName: string, mimeType?: string, options?: {
    ocrEnabled?: boolean;
}): Promise<string>;
/** Strip an HTML document down to its title and body text. */
export declare function extractFromHtml(html: string): {
    title: string;
    text: string;
};
/**
 * HTML → Markdown via turndown (headings/lists/links/code blocks/tables
 * survive, so the heading-aware chunker works — the local analogue of Cherry's
 * Jina Reader output). Page chrome (nav/footer/aside/form/iframe/svg) is
 * stripped first. Falls back to the regex text strip when turndown is
 * unavailable or yields nothing.
 */
export declare function extractHtmlToMarkdown(html: string): Promise<string>;
/** Full HTML document extraction: title + structure-preserving Markdown body. */
export declare function extractHtmlDocument(html: string): Promise<{
    title: string;
    text: string;
}>;
/**
 * Mean length of the non-empty lines of extracted text. Healthy text layers
 * average well above this (paragraphs of 20–80 chars); per-glyph-laid-out
 * math PDFs and corrupt-encoding layers average below 5 (one glyph per
 * "line"). This heuristic decides whether a text layer is usable as-is,
 * needs coordinate reassembly, or needs OCR instead. Exported for tests.
 */
export declare function averageLineLength(text: string): number;
/** Terminate native parser heaps when a plugin instance is unloaded. */
export declare function disposePdfParsers(): Promise<void>;
//# sourceMappingURL=parse.d.ts.map