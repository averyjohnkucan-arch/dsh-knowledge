/**
 * OCR inference process — PaddleOCR (PP-OCRv5 mobile, Cherry's engine choice
 * with a full Chinese dictionary) runs here first, Tesseract.js as fallback.
 * A native/WASM fatal exits this child instead of the DSH host. Requests are
 * serialized so the engines never share concurrent inference state.
 *
 * Protocol: versioned IPC with advanced Buffer/Uint8Array serialization.
 * @module dsh-knowledge/knowledge/ocr-process
 */
export {};
//# sourceMappingURL=ocr-process.d.ts.map