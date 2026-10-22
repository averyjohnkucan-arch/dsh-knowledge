# Vectorization scheduling

Markdown folder reconciliation no longer counts as OCR. Folder inventory tracks outstanding non-text sources separately; saved-text rechunking is normalization. Text synchronization claims document ownership before asynchronous reads, and vector backfill respects that claim. CUDA admission starts during warmup; long NPU inputs can use CUDA while parsing reserves CPU. Local backfill admits eight bounded document lanes to supply device batches.

Foreground work releases NVIDIA and NPU; Intel GPU yields when explicitly reserved. All acceleration retains normalization, finite-vector and CPU-reference qualification. Intel FP32 compute on the canonical FP16 export passed live qualification at minimum cosine 0.9999986676.

Validation: 99 focused tests, TypeScript check and production build passed on the isolated candidate. Live Wikipedia vectorization advanced from zero to 82 documents; short pre-OCR samples measured approximately 1.6–2.1 documents/second. PDF reconciliation subsequently started OCR and correctly paused new vector work. This is not a complete-corpus or PDF end-to-end throughput claim.

Live SSD sample during concurrent PDF OCR and text reconciliation: root NVMe busy time 2.75–4.60%, reads 4.1–4.6 MiB/s, writes 16.6–76.3 MiB/s; no swap-in/out during the interval. Earlier 100% spikes were not reproduced in this sample.

OCR dispatch now prioritizes idle accelerators by their last assignment before queueing behind busy lanes. This prevents persistent NPU starvation from CUDA timing estimates; CPU remains reserved for parsing while accelerators are available. Foreground handoff and output validation remain unchanged. Two added regression tests cover serial-arrival starvation and a busy-CUDA/idle-NPU queue.
