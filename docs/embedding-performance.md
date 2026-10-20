# Embedding performance and installation

## Fresh DSH installation

1. Install the plugin from `https://github.com/averyjohnkucan-arch/dsh-knowledge` using the GitHub link installer.
2. Open Settings → Local Models. Download the standard local models, or use Download / validate CPU and NPU embedding for the optional OpenVINO export.
3. Select an installed model in the knowledge base settings and save. Existing lexical-only documents are embedded from canonical text, without parsing or OCR again. Backfill progress is durable across restarts when automatic recovery is enabled.
4. The original ONNX model and the OpenVINO export have different model identities and vector spaces. Changing between them requires a new or rebuilt base.

The plugin owns Python bootstrap, pinned Intel user-space runtime libraries, model downloads, validation, queues and CPU fallback. Cache paths derive from the DSH home or the configured model cache. No old Local AI paths, Strata or NInfer plugins are required. Linux and Windows x64 bootstrap paths are included. Kernel/device drivers must already be available; the plugin never installs drivers into the OS. Windows execution has not been verified on hardware.

## Measured results

Intel Core Ultra 9 285HX, 24 logical CPUs, Intel AI Boost NPU. Tests used the same 32 real passages of 300–1000 characters, while other ingestion work continued. These are comparison measurements, not a whole-library average or a pages-per-minute claim. Cold model loading is excluded from warm rates.

| Configuration | Warm chunks/sec | Notes |
|---|---:|---|
| CPU, 8 threads, batch 8 | 4.8 | Larger padded inference batch |
| CPU, 8 threads, batch 32 | 1.9 | Approximately 5.6 GiB process RSS |
| CPU, 1 instance × 8 threads, micro-batch 1 | 11–12 | Approximately 1.2 GiB model process RSS |
| CPU, 2 instances × 8 threads, micro-batch 1 | 16.6–16.9 | Actual plugin IPC path; approximately 2.4 GiB combined model process RSS |
| CPU, 4 instances × 4 threads | 15.4–16.2 | Approximately 4.8–5.1 GiB, no compelling gain |
| NPU, 1 request | 7.8 | OpenVINO export |
| NPU, 2 concurrent requests | 8.1 | Small gain; one NPU lane retained |
| OpenVINO, CPU + NPU plugin scheduler | Up to 15.7 | Short warm run; sample and load dependent |

ONNX pool vectors matched the original single-text CPU path at cosine ≥0.9999996. OpenVINO CPU/NPU vectors matched each other at cosine ≥0.9995 in calibration. Mixing the two exports is explicitly prevented by their different model IDs. A warm OpenVINO query took approximately 0.13 seconds in the small test.

## Configuration and scheduling

Settings → Local Models → Embedding performance exposes CPU threads per instance, instance count and texts per micro-batch. Zero chooses hardware-bounded automatic defaults. The NPU export adds a validated NPU lane alongside CPU workers. Longer inputs unsupported by the NPU fall back to CPU without truncation. A device error disables that lane until revalidation.

Optional Intel iGPU and main GPU workers require five minutes of verified desktop idle and a passing comparison against the same-export CPU. The main GPU also requires no other detected CUDA compute owner. Each worker checks the actual GPU vendor. These paths were not enabled during active-desktop benchmarks and should not be described as hardware-verified yet.

Foreground LLM calls use the existing `llm/stream` hook to withdraw GPU work before the model call. Desktop activity is checked periodically. New background GPU jobs stop immediately on a detected demand; the active job has a ten-second maximum grace period. Interrupted batches are retried on CPU. Idle detection is conservative and cannot identify every possible external application’s intent before it becomes observable.

Model weights remain separate downloads. Installer pins and SHA-256 hashes are in `scripts/openvino-embedding-manifest.json`; the model comes from the official OpenVINO Hugging Face organization under Apache-2.0. Python 3.12.15, the private Python package set, and Intel runtime versions are pinned in the bootstrap, requirements file and runtime manifest. The Python bootstrap was tested with an empty system PATH.
