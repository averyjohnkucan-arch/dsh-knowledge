/** Shared model capability policy; never truncate an arbitrary embedding model. */
export interface DimensionConfig {
  embeddingProvider: string
  embeddingModel: string
  /** Zero/absent keeps native output, preserving existing vector identities. */
  embeddingDimensions?: number
}
export function embeddingDimensionSupport(model: string): { native?: number; min?: number } {
  if (/qwen3[-_]embedding[-_:/]0[.]6b/i.test(model)) return { native: 1024, min: 32 }
  if (/bge-small-zh-v1[.]5/i.test(model)) return { native: 512 }
  if (/(bge-small-en-v1[.]5|gte-small|multilingual-e5-small)/i.test(model)) return { native: 384 }
  return {}
}
export function embeddingOutputDimensions(config: DimensionConfig): number {
  const value = config.embeddingDimensions ?? 0
  if (!Number.isInteger(value) || value < 0) throw new Error('Vector dimensions must be a non-negative integer (0 = model default)')
  if (config.embeddingProvider === 'none' || value === 0) return 0
  const support = embeddingDimensionSupport(config.embeddingModel || (config.embeddingProvider === 'local' ? 'Qwen3-Embedding-0.6B' : ''))
  if (value === support.native) return 0
  if (support.min === undefined || support.native === undefined) throw new Error('This model has no supported dimension reduction. Use its native dimensions (0 = model default)')
  if (value < support.min || value > support.native) throw new Error(`Vector dimensions for this model must be ${support.min}–${support.native}, or 0 for the model default`)
  return value
}
/** Matryoshka prefix followed by L2 normalization; used identically for documents and queries. */
export function resizeEmbeddingVectors(vectors: number[][], dimensions: number): number[][] {
  if (dimensions === 0) return vectors
  return vectors.map(vector => {
    if (vector.length < dimensions) throw new Error(`Embedding returned ${vector.length} dimensions; requested ${dimensions}`)
    const prefix = vector.slice(0, dimensions)
    const norm = Math.sqrt(prefix.reduce((sum, value) => sum + value * value, 0))
    if (!Number.isFinite(norm) || norm === 0) throw new Error('Embedding has an invalid or zero-length vector prefix')
    return prefix.map(value => value / norm)
  })
}
export function embeddingDimensionTag(config: DimensionConfig): string {
  const dimensions = embeddingOutputDimensions(config)
  return dimensions === 0 ? '' : `:dimensions-${dimensions}`
}
