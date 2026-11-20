# OCR pipeline benchmark

This read-only replay runs the plugin's real built-in PDF parser, isolated raster workers, and CPU/NPU/iGPU/CUDA OCR scheduler. It does not modify a knowledge base, enable embeddings, index chunks, or run a language model. Pause live OCR imports first so they do not compete with the replay. Model/runtime setup is separate.

The runnable benchmark is included in the built plugin; it needs no development packages:

```sh
npm run benchmark:ocr -- /path/to/pdfs /tmp/ocr-results.json
```

The optional third argument sets simultaneous documents (default 8); the fourth limits the number of PDFs (default all). Files are sorted and content-hashed before timing. Each replay starts fresh worker processes; downloaded weights, compiled Intel models, and the OS file cache can remain warm. JSON includes per-document time/failure, explicit OCR page count, inference requests by device, and a corpus hash. CPU reference comparisons count as extra inference requests, not extra document pages.

For controlled experiments, `DSH_BENCH_GPU_WORKERS`, `DSH_BENCH_CPU_WORKERS`, `DSH_BENCH_CPU_THREADS`, `DSH_BENCH_NPU_WORKERS`, and `DSH_BENCH_IGPU_WORKERS` override only this standalone replay. Counts above eight CUDA workers are experimental and retain the VRAM availability check. `DSH_MODEL_CACHE` selects an existing model cache outside the default DSH home. These benchmark overrides do not change saved DSH settings.

The release notes record the measured corpus and results. Results depend on documents, device availability, driver/runtime versions, and power mode. Higher utilization alone is not a throughput improvement. Foreground inference retains the plugin's public-hook device reservation policy in normal DSH operation; run the standalone benchmark when no inference is active.
