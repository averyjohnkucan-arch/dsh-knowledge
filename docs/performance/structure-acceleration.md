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
