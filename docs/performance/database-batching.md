# Database batching and checkpoint I/O

This change targets the shared storage path used by Wikipedia imports, PDF imports, and embedding checkpoints. It does not change OCR models, chunk contents, or retrieval algorithms.

- Concurrent checkpoint requests share a transaction, bounded to 128 requests or an estimated 16 MiB. Each request has a savepoint; a bad document does not roll back its neighbours. Other mutations end the coalescing window to preserve ordering.
- New staged vectors use their existing float32 binary column instead of duplicating the vector as decimal JSON. Published vectors already use float32. Existing JSON checkpoints remain readable. Acknowledgement still waits for commit.
- Repeated identical checkpoints skip row updates.
- A one-time, transactional trigger migration prevents unchanged search text from rebuilding trigram postings during vector-only upserts. Actual text edits still update FTS. No table/index rebuild is needed.

## Validation

Against baseline `ff98de8`, an isolated deterministic workload of 64 documents, 512 chunks, 1024-dimensional vectors, and 32 concurrent documents produced:

| Metric | Before | After |
| --- | ---: | ---: |
| Checkpoint commits | 256 | 8 |
| Checkpoint WAL bytes | 21,172,712 | 3,296,032 |
| Total WAL bytes through publication | 36,391,992 | 7,531,392 |
| Checkpoint time | 77.1 ms | 18.2 ms |
| Total database phase time | 205.9 ms | 113.1 ms |

These are generated WAL bytes and single-run database timings in disposable databases with automatic checkpointing disabled for measurement. They are not physical SSD write measurements or end-to-end import throughput. They exclude OCR, parsing, model inference, artifact storage, and source-file reads. Timing varies with load; no one-document-per-second claim is made.

Run `node scripts/benchmark-database-batches.mjs ff98de8` to reproduce. The benchmark never opens production storage and removes its temporary databases afterward.

Regression tests cover FTS integrity after vector/text updates, unchanged-write suppression, legacy checkpoints, vector recovery, transaction coalescing, per-document rollback, deletion ordering, and ingestion. The exact publication candidate passed 141 focused integration tests with one existing skip, TypeScript checking, and the production build.

## Testing in DSH

Build this branch in a separate checkout before installing it; keep any existing local changes. Allow the running import to finish before replacing/restarting the plugin. The trigger migration runs on next database open. There is no need to delete existing data or re-embed existing vectors.

Compare the same import/embedding workload and settings before and after, recording completed documents, elapsed time, process read/write counters, and database/WAL sizes. This optimization reduces storage overhead; extraction and model execution can still dominate total time.
