

## Length fallback and device requalification

NPU/iGPU token limits no longer force indexing passages into a CPU-only fallback queue when qualified CUDA capacity is available. Foreground/query work retains CPU fallback, and CUDA failures still recover on the reference CPU. Failed GPU qualification reports the current minimum cosine and retries after five minutes using the same 0.995 threshold; no unqualified indexing work is admitted. Runtime failure retry keys are consistent with admission keys, and successful requalification clears stale error messages.

A live 111.51-second pre-deployment sample completed 2,699 additional vectors (24.20/s), with mean NVIDIA utilization 38.75%. The post-deployment workload must be measured separately; this is not a claimed speedup. Direct Python and plugin separate-worker checks of the three runtime calibration texts gave iGPU/CPU cosine above 0.999998, despite an earlier live qualification failure. The cause of that initial discrepancy is not established; retries retain the full check. A 128-vector stored sample had 1,024 finite components and norms within approximately 3e-8 of one.


Semantic chunking progress now reports the paragraph-embedding pass as embedding, clearing stale parsing/normalizing status and advancing after each completed batch. This is an observability correction, not a measured inference speedup. Large documents can require thousands of segment embeddings before a final chunk generation is published.


Startup raw-source recovery now registers its complete parsing backlog before asynchronous reads and exposes the active file as parsing. Both OCR and parsing admission barriers include that backlog, preventing vector backfill from occupying accelerators between resumed files. Every success, failure and shutdown path releases the markers; failed imports retain their normal error state.
