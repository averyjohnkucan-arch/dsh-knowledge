/** Join adjacent PDF text runs using a baseline tolerance, not exact float equality.
 * Keep producer order so separate columns are not interleaved by global y sorting.
 */
export function joinPdfTextItems(items) {
  let text = '', previous
  for (const item of items) {
    if (typeof item.str !== 'string' || !item.str) continue
    const x = item.transform?.[4] ?? 0, y = item.transform?.[5] ?? 0
    const height = Math.abs(item.height || item.transform?.[3] || 10)
    if (previous) {
      const tolerance = Math.max(.5, Math.min(height, previous.height) * .35)
      const newLine = Math.abs(y - previous.y) > tolerance || x < previous.x - tolerance
      if (newLine) text += '\n'
      else {
        const gap = x - previous.right
        if (gap > Math.min(height, previous.height) * .12 && !/\s$/.test(text) && !/^\s/.test(item.str)) text += ' '
      }
    }
    text += item.str
    previous = { x, y, height, right: x + (Number.isFinite(item.width) ? item.width : 0) }
  }
  return text.replace(/\u00ad\s*\n\s*/g, '').replace(/\u00ad/g, '').replace(/[ \t]+\n/g, '\n')
}
