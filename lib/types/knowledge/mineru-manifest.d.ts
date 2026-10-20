import type { MineruModelFile } from './mineru-deployment-types.js';
/** Fixed adapter + upstream registry, not a moving model list.
 * Metadata: official HF API, 2026-09-27. YAML uses Git blob IDs; LFS uses SHA-256.
 * Only required registry paths, excluding README/metadata. Sizes are bytes. */
export declare const MINERU_RUNTIME_VERSION = "4.0.6";
export declare const MINERU_MODEL_REPO = "opendatalab/MinerU-4_models_onnx";
export declare const MINERU_MODEL_REVISION = "358310b4f64b95f9fefc372ad899356e4111f376";
export declare const MINERU_MODEL_DIRECTORY = "MinerU-4_models_onnx";
export declare const MINERU_MODEL_METADATA_DATE = "2026-09-27";
export declare const MINERU_BASIC_FILES: readonly MineruModelFile[];
//# sourceMappingURL=mineru-manifest.d.ts.map