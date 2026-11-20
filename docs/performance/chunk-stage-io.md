# Chunk-stage write batching

A 20-second CPU profile of the live Wikipedia chunking stage showed SQLite generation publication dominating the host thread, including nested metadata savepoints, chunk insertion and commit. Text segmentation was not the dominant sampled cost. The profile is not evidence that CPU splitting or accelerator offload alone will remove the bottleneck.

The normal publication path now writes the whole batch in one transaction without per-document or metadata savepoints. If a row operation fails, it rolls the entire attempt back and retries with per-document isolation. Vector caches update only after commit. Standalone metadata writes retain their own atomic protection.

Plain-text/Markdown-only imports can admit 128 chunk publications to match the existing writer's batch capacity, instead of limiting every batch to 32. Files larger than 256 KiB have a separate bounded admission gate before loading their saved output; PDF/mixed imports retain the smaller existing limit.

A paired isolated benchmark used 1,024 real Wikipedia articles, 8,803 chunks, identical inputs per variant, and SQLite WAL autocheckpoint disabled to measure generated WAL bytes. Before: 3,212 ms, 295,103,272 WAL bytes. After, including 128-document batches: 3,045 ms, 215,916,872 WAL bytes. This is approximately 5.5% higher publication throughput and 26.8% fewer WAL bytes, not a measured end-to-end import speedup or physical SSD write measurement. A separate 32-document-batch comparison showed only a small improvement from removing nested savepoints alone.

Validation: 134 service, stage, database and generation tests passed, one skipped. Tests cover failed-batch rollback, healthy-neighbour isolation, full-text search integrity and the savepoint-free successful path. Production build passed. Live CPU profiling and isolated benchmarks do not prove that all four device types perform chunking; that remains a separate scheduling/implementation question.
