# Local document processing

The normal PDF parser extracts the document text. PaddleOCR recognizes scans when
text cannot be extracted. Optional PP-StructureV3 adds table and chart data after
normal parsing; it is not the main PDF parser. General photo descriptions require
a separately selected vision model. PP-StructureV3 does not provide those captions.

In a knowledge base's Settings:

- **File Processing** selects the main parser. Keep **Built-in parser** for ordinary
  local PDF extraction. MinerU choices are separate optional integrations.
- **PaddleOCR for scanned PDFs** enables or disables local OCR fallback. Install
  its models in **Settings → Local Models** first. Turning it off leaves scanned
  PDFs without extractable text as visible failures rather than fabricated text.
- **Image/table captioning** can be Off, local PP-StructureV3, or a vision provider.
  Selecting local PP-StructureV3 enables its table extraction; its separate chart
  switch enables PP-Chart2Table. Neither option changes the main parser.
- **Use these processing settings as plugin defaults** saves defaults for bases
  without overrides. **Save** applies the panel's changes to the current base.
  Existing parsed documents require explicit reprocessing to apply parser changes.
- Embeddings and reranking have independent model selections. Downloaded models
  must pass validation before they are ready. Selecting a model does not save it;
  use **Save**. The current import-time guard may refuse enabling embeddings while
  documents are processing; a selected unsaved model does not enable semantic search.

Recommended local selections are Qwen3 Embedding 0.6B, BGE Reranker Base,
PaddleOCR v5, and optional PP-StructureV3/PP-Chart2Table. Weights download separately.
The structure installation is substantially larger than the small OCR-only model
pack because it includes additional models and an isolated Python runtime.

The local implementations explicitly select CPU and hide CUDA devices from their
workers. Intel iGPU/NPU execution has not been qualified in this release. External
vision services manage their own hardware; choosing one does not enforce CPU use.

## Progress and ETA

The processing summary shows completed/total documents, newly processed,
unchanged, failed, queued, and running counts. Folders do not count as documents.
Supported files are counted before a folder pass begins; discovery is shown while
that inventory runs. The inventory does not load document contents.

The ETA uses completions in the last 120 seconds, including unchanged checks and
failed attempts. It needs at least two completions and ten seconds of observations.
A stalled window returns to “Estimating time remaining.” Document sizes and OCR
requirements vary, so the estimate is approximate. Counters are in memory for the
current host session; a restarted synchronization starts a new measurement window.
The progress bar does not call a stopped, partially completed run “Finished.”

These changes are staged in plugin source. They require a plugin reload after the
current import finishes; source edits do not retroactively instrument a running pass.
