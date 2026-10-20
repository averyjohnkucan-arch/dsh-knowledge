/** Cover the entire input when an embedding model has a short context window. */
export async function embeddingWindows(text: string, limit: number, count: (text: string) => Promise<number>): Promise<Array<{ text: string; tokens: number }>> {
  const out: Array<{ text: string; tokens: number }> = []
  const visit = async (part: string): Promise<void> => {
    const tokens = await count(part)
    if (tokens <= limit) { out.push({ text: part, tokens }); return }
    if (part.length < 2) throw new Error('Embedding model context is too small for this text')
    let cut = Math.floor(part.length / 2)
    const floor = Math.floor(part.length / 3)
    for (const boundary of ['\n\n', '\n', '. ', ' ']) {
      const found = part.lastIndexOf(boundary, cut)
      if (found > floor) { cut = found + boundary.length; break }
    }
    if (cut > 0 && /[\uD800-\uDBFF]/.test(part[cut - 1]) && /[\uDC00-\uDFFF]/.test(part[cut] ?? '')) cut--
    if (cut <= 0) cut = 2
    if (cut >= part.length) throw new Error('Cannot divide input within embedding context')
    await visit(part.slice(0, cut)); await visit(part.slice(cut))
  }
  await visit(text)
  return out
}
export function mergeWindowVectors(vectors: readonly number[][], weights: readonly number[]): number[] {
  if (vectors.length === 1) return vectors[0]
  if (!vectors.length || vectors.length !== weights.length || vectors.some(v => v.length !== vectors[0].length)) throw new Error('Invalid embedding windows')
  const result = new Array<number>(vectors[0].length).fill(0)
  vectors.forEach((vector, i) => vector.forEach((value, j) => { result[j] += value * weights[i] }))
  const norm = Math.hypot(...result)
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Invalid pooled embedding')
  return result.map(value => value / norm)
}
