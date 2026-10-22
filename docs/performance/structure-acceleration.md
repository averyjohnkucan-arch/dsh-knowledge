# Qualified structure acceleration

The idle structure scheduler shares bounded PDF page ranges among qualified CUDA, OpenVINO NPU/iGPU layout, and CPU workers. CUDA claims up to eight pages; the CPU-backed lanes claim one. A single temporary source PDF is shared. Range outputs must cover every original page exactly once before a document is committed. Device failure retries only the affected range on CPU.

Foreground inference reserves accelerators and leaves background work CPU-only. Intel admission uses two engine-counter samples on startup and yields to detected external activity. Idle CUDA OCR model caches yield after ten seconds without pending OCR when another Knowledge stage requests the GPU; ordinary short rendering gaps remain warm.

## Precision and qualification

- CUDA chart decoding uses FP32, with BF16 selection and TF32 disabled. Default BF16 changed chart numbers on the validation corpus and was rejected.
- NPU/iGPU layout screening uses a conservative threshold, then the original Paddle reference detector supplies crop coordinates for selected tables/charts. Direct NPU crops changed table cells and were rejected.
- The NPU IR retains model weights and TopK semantics; fixed shapes and constant folding resolve the exported unknown TopK axis/rank.
- Quality comparisons tolerate punctuation/whitespace but check numeric values, cell relationships, block identities and complete page coverage. Sample agreement is not proof of whole-corpus equivalence.

## Measurements on this machine

Intel Core Ultra 9 285HX, 122 GiB RAM, Intel AI Boost NPU, Intel iGPU, NVIDIA RTX PRO 5000 Blackwell laptop GPU (24 GiB).

| Backend | Eight-page layout time | Rich extraction responsibility |
|---|---:|---|
| CPU | 20.88 s | CPU tables and chart generation |
| NPU | 2.13 s | NPU screening; CPU reference crops and rich extraction |
| Intel iGPU | 3.72 s | iGPU screening; CPU reference crops and rich extraction |
| NVIDIA CUDA | 0.17 s in a warm stage profile | CUDA layout, tables and charts |

These timings come from separate runs under live load and are not a controlled simultaneous-device comparison. Full warm CUDA extraction on the eight-page sample took 4.95 s. An earlier CPU reference run took 175.7 s with different startup/load conditions. Both produced identical checked table/chart content after precision safeguards. Range rendering was pixel-identical; a subsequent CPU range extraction matched the reference in 177.85 s.

Batches larger than eight and FP16 chart decoding did not show consistent gains; FP32 remains selected. The corpus contains 250 PDFs with 30,571 pages (median 49, maximum 2,126). One document per second requires more than 122 pages/s across all required stages. That rate and a 95% practical-performance claim have not been established.

## Validation and remaining work

The isolated candidate passes TypeScript, production build and 50 focused tests covering resource handoff, range scheduling, partial-range rejection, failed-range retry, quality normalization and OCR cache handoff. Live range scheduling recovered completed documents and progressed without reported failures. Per-device page/request/time counters are exposed in structure status for subsequent measurement.

Sustained full-corpus throughput and the embedding stage still require verification. Optional accelerator runtimes and qualification receipts are local artifacts; a CPU-only installation remains supported. No model weights or machine-specific runtime binaries are committed.

## Concurrent CUDA qualification

A controlled sample with the same four eight-page requests completed in 19.35 s and 15.32 s with one warm CUDA worker, versus 12.67 s and 11.97 s with two. All checked content matched. The earlier single-worker round still showed warmup/live-load effects; comparison against the warmer 15.32 s round suggests approximately 17–22% lower elapsed time for this sample, not a whole-corpus guarantee.

The scheduler now admits at most two CUDA workers, requiring 8 GiB of free VRAM for a new worker and reserving that budget for other workers still loading. Warm workers require 2 GiB headroom. Two CPU-backed structure lanes remain bounded separately. Foreground handoff releases both CUDA workers. No decoding precision or token limit changed.

## Chart and admission refinements

Qualified chart batching groups at most two original crops within a bounded page range and restores page/result associations. Four-chart sample decoding improved from 6.25–6.58 s to 4.93–5.49 s, with unchanged checked content; integrated timings are workload-dependent. Single-chart/no-table enrichment can bypass general OCR whose text would be discarded, using the same crop and decoder. Warm sample improvements were approximately 12% for two chart pages and 4% for the mixed eight-page sample. Both paths together matched saved full-pipeline outputs. These paths require the local GPU qualification receipt to specify `chartBatchSize: 2` and/or `singleChartDirect: true`; ordinary full extraction, multi-chart ordering and tables retain the reference path as applicable.

CPU-capacity waits no longer occupy outer scheduler slots. A regression holds both CPU workers and verifies newly available CUDA completes other queued work before either CPU worker is released. Startup embedding readiness queries no longer qualify indexing GPU workers; idle embedding workers yield to other Knowledge stages after a short grace period.

The combined isolated candidate passes TypeScript, production build and 57 focused tests. Sample quality is not whole-corpus ground truth; final sustained throughput remains under measurement.


### Qualified CPU chart threading

The private CPU `ready.json` receipt may opt into `chartThreads: 2` or `4`. This scopes OpenMP limits to the dynamic chart decoder, restoring prior limits on return or error. It does not enable oneDNN or alter CUDA precision. The optional `threadpoolctl` package must be installed; without it the original decoder remains in use. Leave this setting absent on unqualified machines.

On the tested Core Ultra 9 285HX, the same two-chart sample took 110.31/109.86 seconds without the scoped override, 96.65 seconds at four threads, and 93.35 seconds at two threads under live load. All checked text, numeric values and cell relationships matched. A mixed eight-page test with the production static-thread setting also matched the saved table/chart reference. These small samples are not a full-corpus speedup guarantee. CPU batching was slower (129.37 seconds at two threads and 146.57 at four); it remains disabled. Enabling oneDNN failed on an unsupported Paddle PIR attribute and also remains disabled.


### Admission polling overhead

Structure queue waiters skip NVIDIA subprocess probes when both CUDA lanes are already busy or reserved. Concurrent Intel availability requests with identical device ownership share one in-flight scan; subsequent requests still obtain a fresh sample, and changed ownership is evaluated separately. Foreground admission and external-compute checks remain in place. Before deployment, a five-second live sample of the Node host averaged 137.92% CPU (91.22% system time) with zero physical disk reads/writes during that sample. This establishes overhead to investigate, not a measured speedup or proof that all host CPU time is polling.
