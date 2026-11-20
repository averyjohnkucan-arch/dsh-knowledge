# Import-wide stages

Folder imports now inventory their files before executing four barriers:

1. **OCR/source extraction.** Native source decoding and OCR run for every changed file. PDF decoding is necessary to identify scanned pages and render them. Already saved extraction is reused when the source hash and processor settings match.
2. **Parsing/enrichment.** Table and chart interpretation consumes extracted text. Models may perform internal recognition of table/chart crops; the full source OCR pass is not repeated.
3. **Chunking/publication.** Completed parsing is consumed by existing document generation and lexical chunk publication. Embedding backfills remain gated until every chunking job settles.
4. **Vectorization.** Existing batched embedding/backfill consumes saved chunks. Semantic merging is included here because it requires embeddings. Missing vectors are reported as failures rather than successful pipeline completion.

Each stage has bounded concurrency. Intermediate extraction/parsing output is stored in private temporary checkpoints; queue entries retain paths and document headers, not all PDF bytes. Checkpoints are atomic and separate from published knowledge documents. A restart can require rerunning uncommitted extraction; these temporary files are not a durable restart journal. A durable folder marker reschedules interrupted imports on startup, honors the auto-resume setting, and limits automatic restart attempts to three. Changes to source bytes/settings between stages are rejected instead of silently invoking OCR during chunking.

Failures exclude the affected file from subsequent stages. Cancellation drains running stage callbacks before removing temporary checkpoints. Existing source reconciliation, saved parsing reuse and atomic document-generation publication are retained. Stage progress and device roles appear in the import UI.

## Hardware limits

OCR uses available, qualified CPU, iGPU and NVIDIA lanes. The current full-page NPU OCR path remains excluded by model validation; NPU page-layout inference is separate and supported. Table/chart interpretation uses CPU/CUDA, with NPU/iGPU layout screening. Spare CPU capacity can process rich pages while CUDA lanes are busy rather than waiting behind them. Chunking is ordinary CPU text processing and has no GPU/NPU implementation. The accelerated FP16 embedding model supports all four device classes, subject to input-length, memory, qualification and other-model reservations. Foreground inference retains CPU-only background operation.

This change does not claim 100% utilization on every chip or a measured overall speedup. A service integration test uses three real minimal PDFs and a deterministic embedding provider to verify stage ordering and stored vectors. Device throughput and live end-to-end validation are separate checks.
