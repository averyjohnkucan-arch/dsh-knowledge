/** Linear traversal; visiting each file must not rescan a 50,000-document library. */
export function documentSubtreeIds(documents: readonly { id: string; parentDirectoryId?: string }[], rootId: string): string[] {
  const children = new Map<string, string[]>()
  for (const doc of documents) {
    if (doc.parentDirectoryId === undefined) continue
    const siblings = children.get(doc.parentDirectoryId) ?? []
    siblings.push(doc.id)
    children.set(doc.parentDirectoryId, siblings)
  }
  const result: string[] = [], seen = new Set<string>(), pending = [rootId]
  while (pending.length) {
    const id = pending.pop()!
    if (seen.has(id)) continue
    seen.add(id); result.push(id)
    const descendants = children.get(id)
    if (descendants) for (let i = descendants.length - 1; i >= 0; i--) pending.push(descendants[i])
  }
  return result
}
