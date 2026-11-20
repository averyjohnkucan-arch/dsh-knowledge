/**
 * Local model inference process — Cherry Studio's isolated-runtime model:
 * transformers.js / onnxruntime run off the main process, so the ~600MB
 * embedding model (and any local reranker) plus every inference intermediate
 * tensor lives outside the host process and can never freeze it.
 *
 * Wire protocol (versioned IPC over a worker port or child-process IPC):
 *   main → process: { protocolVersion, id, operation, modelId, cacheDir, ... }
 *   process → main: { protocolVersion, id, operation, ok, vectors? | error }
 *                    { type: 'progress', modelId, status, progress, message }
 *
 * Inference is serialized inside the process (Cherry's inference queue has
 * concurrency 1 for the same reason: transformers.js gives no concurrency
 * guarantee for parallel runs on one pipeline instance).
 * @module dsh-knowledge/knowledge/embed-process
 */
export {};
//# sourceMappingURL=embed-worker.d.ts.map