

## Length fallback and device requalification

NPU/iGPU token limits no longer force indexing passages into a CPU-only fallback queue when qualified CUDA capacity is available. Foreground/query work retains CPU fallback, and CUDA failures still recover on the reference CPU. Failed GPU qualification reports the current minimum cosine and retries after five minutes using the same 0.995 threshold; no unqualified indexing work is admitted. Runtime failure retry keys are consistent with admission keys, and successful requalification clears stale error messages.

A live 111.51-second pre-deployment sample completed 2,699 additional vectors (24.20/s), with mean NVIDIA utilization 38.75%. The post-deployment workload must be measured separately; this is not a claimed speedup. Direct Python and plugin separate-worker checks of the three runtime calibration texts gave iGPU/CPU cosine above 0.999998, despite an earlier live qualification failure. The cause of that initial discrepancy is not established; retries retain the full check. A 128-vector stored sample had 1,024 finite components and norms within approximately 3e-8 of one.


Semantic chunking progress now reports the paragraph-embedding pass as embedding, clearing stale parsing/normalizing status and advancing after each completed batch. This is an observability correction, not a measured inference speedup. Large documents can require thousands of segment embeddings before a final chunk generation is published.


Startup raw-source recovery now registers its complete parsing backlog before asynchronous reads and exposes the active file as parsing. Both OCR and parsing admission barriers include that backlog, preventing vector backfill from occupying accelerators between resumed files. Every success, failure and shutdown path releases the markers; failed imports retain their normal error state.


CUDA OCR recognition batches now group crops by their batch-one padded width, preserving preprocessing and output order. CUDA explicitly disables TF32 after fixed-page comparisons showed text drift; FP32 width-preserving batches matched the CPU single-line reference on three repeated sample pages. These samples are consistency checks, not full-corpus ground truth.

Intel CPU/iGPU OCR explicitly requests FP32. On three fixed page rasters repeated twice, default iGPU precision changed the faint scan substantially; explicit FP32 matched the CPU reference in all six outputs. NPU uses a separate static-shape path and requires separate validation. Numeric qualification tolerates spacing before percent signs while preserving the sign itself.

Deferred rich pages may be submitted as up to eight sorted unique page indices, including gaps. Only selected pages are rendered. Returned coverage and block page identities are validated, and blocks are restored to document order. This enables the existing qualified chart crop batching across nonadjacent pages without extracting or rewriting intermediate PDFs.

On a seven-page fixture with four chart pages separated by blank pages, two warm selected-page runs took 4.71–4.83 seconds versus 5.98–6.01 seconds for individual requests, preserving all checked text, numbers, relationships and page identities. These small diagnostic runs overlapped the active import; they support this batching path, not a whole-corpus speedup claim.


Full-page PP-OCRv5 NPU execution is not admitted from the earlier synthetic calibration receipt. Fixed raster tests exposed substantial scanned-text changes; exact shapes and CPU-recognition hybrids improved consistency, but a held-out handwritten number still differed. A strict numeric retry rule sent all 14 sampled pages back to CPU, adding work without a demonstrated benefit. OCR status explicitly reports the NPU fidelity exclusion. NPU layout screening and embedding qualification remain independent and available. CPU, qualified FP32 iGPU and qualified FP32 CUDA OCR remain enabled. Re-enabling NPU full-page OCR requires a new validated implementation, not merely repeating the original synthetic calibration.
