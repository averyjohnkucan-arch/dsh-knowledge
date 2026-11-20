/** Compatible architecture, distinct vector formats: migrate vectors without parsing sources again. */
const QWEN_VARIANTS = new Set([
  'onnx-community/Qwen3-Embedding-0.6B-ONNX',
  'OpenVINO/Qwen3-Embedding-0.6B-int8-ov',
  'dsh-local/Qwen3-Embedding-0.6B-FP16-Accelerated',
])
export function canMigrateQwenVectors(before: { embeddingProvider: string; embeddingModel: string }, after: { embeddingProvider: string; embeddingModel: string }): boolean {
  return before.embeddingProvider === 'local' && after.embeddingProvider === 'local'
    && QWEN_VARIANTS.has(before.embeddingModel) && QWEN_VARIANTS.has(after.embeddingModel)
}
