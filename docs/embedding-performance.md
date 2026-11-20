# Qwen embedding performance and installation — 0.5.4

## Fresh installation

Paste `https://github.com/averyjohnkucan-arch/dsh-knowledge` into DSH's plugin
installer. The default branch contains compiled assets. Restart DSH and refresh.
In Settings → Local Models, download/validate **Qwen3 Embedding 0.6B FP16
accelerated**, then select that model in the base settings. All runtime setup,
pinned model downloads, device probes, queues and fallbacks belong to this
plugin. No harness patches, old Local AI directory, Strata or NInfer dependency
is required. Models remain separate downloads because of their size.

The private CPU/Intel environment and optional CUDA environment live under the
plugin's model cache. Windows and Linux bootstrap paths are included. Hardware
validation below was on Linux; Windows hardware execution is not certified.
Kernel/device drivers are prerequisites and are never installed into the OS by
this plugin. If optional CUDA setup fails, CPU/NPU remain usable.

Recognized Qwen export changes migrate vectors from existing chunks rather than
repeating OCR or parsing. Model IDs and versioned vector formats isolate Q8,
OpenVINO int8 and accelerated FP16 vectors. Lexical retrieval remains available.
Existing tiny chunks need an explicit **Rechunk saved parsing result** to adopt
new packing/semantic settings. **Re-vectorize all** preserves chunk text and IDs
and recomputes only vectors, with durable progress and checkpoints.

## Measured embedding rates

Intel Core Ultra 9 285HX, Intel AI Boost NPU, Intel iGPU, RTX PRO 5000 Blackwell
laptop 24 GB, NVIDIA driver 615.71.09. Tests ran on 2026-10-20 using 32 real
Wikipedia passages repeated as stated, 300–1000 characters / 82–232 Qwen tokens.
These are warm **embedding rates**, excluding downloads, cold model load,
parsing, OCR and database publication. They are not pages/minute or whole-library
completion estimates. Background desktop load and passage lengths affect rates.

| Configuration | Passages/second | Measurement |
|---|---:|---|
| Previous Qwen Q8 CPU, padded batch 8 | 4.8 | Earlier comparison |
| Previous Qwen Q8 CPU, 2 workers × 8 threads, canonical single inputs | 16.6–16.9 | Plugin IPC path |
| FP16 WebGPU, batch 8 | 27.76 | NVIDIA test |
| Q4/FP16 WebGPU, batch 8 | 34.51 | NVIDIA test; incompatible vectors |
| Native CUDA FP16, 1 worker, batch 16 | 169.30 | 1,280 warm passages |
| Native CUDA FP16, 2 workers, batch 16 each | 192.23 | Same 1,280 passages |
| Final combined plugin scheduler, CPU + NPU + 2 CUDA workers | **104.01–148.02** | Four 128-passage passes: 104.01, 127.14, 148.02, 136.05 |

The final combined path is roughly 6–9 times the earlier two-worker Q8 CPU
comparison on this small sample. The raw CUDA backend rate is higher than the
combined scheduling rate and must not be substituted for end-to-end ingestion.
The iGPU was correctly withheld during combined testing because other desktop
applications used it; its vector correctness was separately verified.

The scheduler now limits outstanding work per lane. Previously it could eagerly
queue many passages behind a slow device and leave the GPU idle at the end.
Similar-length CUDA requests coalesce into bounded batches; two workers are used
when at least 8 GiB is free before loading, otherwise one. More/larger batches
were not automatically better: batch 32 was slower than 16 in the CUDA sweep.

## Vector correctness and quantization

All accelerated FP16 backends use the same pinned model/tokenizer, correct
attention masks and last-real-token pooling. Minimum cosine similarity against
ONNX Runtime CPU on the 32 real passages was:

| Backend | Minimum cosine |
|---|---:|
| Intel NPU | 0.9999875 |
| Intel iGPU | 0.9999418 |
| NVIDIA CUDA | 0.9999931 |

The final combined scheduler returned vectors at minimum cosine ≥0.9999905 in
its four passes. The initial OpenVINO CPU conversion failed consistency checks
on this driver/runtime combination; the final CPU fallback uses ONNX Runtime.
Padding-related inconsistent Q8 batching is kept separate under its canonical
single-input format rather than silently mixing vectors.

Q4/FP16 improved the WebGPU comparison by about 24%, but its minimum cosine
against FP16 was approximately 0.912. That is not evidence of equivalent retrieval
quality. It was therefore **not enabled** in the shared FP16 vector space. Native
CUDA FP16 was faster in the measured workload anyway. No Q4 retrieval-quality
claim or full-library speed claim is made.

## Semantic packing and reuse

Semantic processing first packs nearby short paragraphs into candidates of
approximately 128 estimated tokens, within headings. Zero selects legacy
paragraph candidates. The final chunk size and semantic threshold remain
configurable; headings and fenced code are hard boundaries. Candidate vectors
are consumed incrementally and length-weighted merged vectors are reused, so
there is no second embedding pass over final chunks. Unchanged source sync does
no embedding work.

A separate 16-article, approximately 104 KB sample had 485 paragraph candidates.
Packing at 128 tokens reduced this to 205; semantic threshold 0.75 produced 202
final chunks instead of 461 without packing, about 58% fewer than the original
485 candidates. Embedding time fell from 16.35 to 13.21 seconds in that test.
All 16 coarse topic queries retained the correct article at rank 1. This is a
small sanity check, not a comprehensive passage-recall benchmark. Fewer vectors
reduce storage and candidate-scoring work; they do not guarantee faster or
better answers on every query.

## Device policy and availability

CPU and NPU continue alongside available GPU workers. On the tested Intel driver,
one stable 256-token NPU graph was retained: longer inputs fall back without
truncation. This limit applies to that NPU lane, not Qwen's 32K model context or
final merged chunks. CPU thread count and instances are configurable and bounded
by available hardware. Selected downloaded models warm at startup.

Query embedding stays on CPU/NPU even when a GPU is available. In the final
foreground test, both owned NVIDIA processes exited before the retrieval query;
that query took 0.257 seconds. Reranker and OCR performance are separate stages
and are not represented by this number.

Linux iGPU availability uses observed foreign DRM engine activity. NVIDIA waits
until no external CUDA compute owner reserves the GPU and enough VRAM is free.
Thus a naturally unloaded inference model allows background indexing to resume;
the plugin does not unload or kill an external engine. Foreground DSH inference
uses the existing public `llm/stream` hook to withdraw GPU work before the call.
New GPU jobs stop on detected competition; the active job has a ten-second maximum
grace period and unfinished work retries on CPU. Unknown telemetry denies GPU
admission. Windows additionally requires verified desktop idle. Monitoring cannot
predict every external application's intent before it becomes observable.

## Research used

- [Qwen's official model card](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B): 32K context, 1,024 dimensions, last-token pooling and query instructions.
- [Hugging Face Text Embeddings Inference](https://github.com/huggingface/text-embeddings-inference): Qwen support and batching as a serving optimization. It is not a dependency of this plugin.
- [TEI Qwen batching correction](https://github.com/huggingface/text-embeddings-inference/pull/648): attention masking and batch/single consistency matter; throughput alone is insufficient.
- [ONNX Runtime CUDA documentation](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html): CUDA/cuDNN version compatibility and private pip library preloading.
- [OpenVINO embedding deployment](https://docs.openvino.ai/nightly/model-server/ovms_demos_embeddings.html): precision choices and bounded sequence shapes for NPU deployment.

Published rates from other hardware or LLM generation benchmarks were not treated
as comparable embedding measurements. There is no claim that every possible
optimization is exhausted or that a 200-PDF OCR benchmark has been completed by
these embedding tests.
