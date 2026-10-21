/** Linear-time OCR agreement, tolerant of case/spacing and small decoder differences. */
export function ocrTextAgreement(reference: string, candidate: string): number {
  const clean = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  const a = Array.from(clean(reference)), b = Array.from(clean(candidate))
  if (a.join('') === b.join('')) return 1
  // A title/identifier alone is too little evidence for approximate admission.
  if (a.length < 32 || b.length < 32) return 0
  const grams = (text: string[]) => {
    const counts = new Map<string, number>()
    for (let i = 0; i + 2 < text.length; i++) { const key=text.slice(i,i+3).join(''); counts.set(key,(counts.get(key)??0)+1) }
    return counts
  }
  const left=grams(a),right=grams(b)
  let common=0
  for (const [key,count] of left) common+=Math.min(count,right.get(key)??0)
  return Math.min(2*common/(a.length+b.length-4),Math.min(a.length,b.length)/Math.max(a.length,b.length))
}
export const MIN_OCR_AGREEMENT = .95
