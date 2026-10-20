/**
 * Image/table captioning for imported PDFs (NexusRAG-style visual
 * intelligence): embedded page images are extracted via pdfjs, decorative
 * fragments (rule lines, icons, tiny glyphs) are filtered out by size, and a
 * vision language model describes each remaining figure. The descriptions
 * are appended to the document text so charts become searchable and quotable
 * — OCR reads the labels, captioning reads the meaning.
 *
 * Providers:
 * - `openai`: any OpenAI-compatible vision chat API (`POST {baseUrl}/chat/completions`
 *   with an image_url content part) — Qwen-VL / GPT-4o-mini / SiliconFlow etc.
 * - `ollama`: a local Ollama server (`POST {baseUrl}/api/chat` with base64
 *   images) — llava / qwen2.5vl run fully offline.
 *
 * Captioning is best-effort: a provider failure or an unreachable model
 * leaves the document text untouched (a warn is logged) — imports never
 * block on the vision model.
 * @module dsh-knowledge/knowledge/caption
 */
import { type StructureV3Manager } from './structure-v3.js';
export interface CaptionConfig {
    structureV3?: StructureV3Manager;
    charts?: boolean;
    signal?: AbortSignal;
    provider: 'off' | 'paddle' | 'openai' | 'ollama';
    model: string;
    baseUrl: string;
    apiKey: string;
    /** Effective embedding base URL (fallback for the openai provider). */
    embeddingBaseUrl: string;
}
/**
 * Caption the embedded images of a PDF. Returns the descriptions joined into
 * one block (page order), or '' when the provider is off / nothing to
 * caption / the provider failed.
 */
export declare function captionPdfImages(bytes: Uint8Array, config: CaptionConfig): Promise<string>;
//# sourceMappingURL=caption.d.ts.map