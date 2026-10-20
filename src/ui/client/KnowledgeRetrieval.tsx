import React from 'react'

/** Only producer-owned user/message events are claimed; ordinary chat stays with DSH. */
interface RetrievalEvent {
  type: string
  seq: number
  surfaceOp?: unknown
  data: { id?: string; source?: { kind?: string; passageCount?: number }; content?: readonly { type: string; text?: string }[]; surface?: unknown }
}
interface Match { event: RetrievalEvent; location: unknown }
interface ProjectionContext { key: string; id: string; start?: Match; state?: ReturnType<typeof retrievalRecord> }
export function retrievalRecord(event: RetrievalEvent) {
  const text = (event.data.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')
  const count = event.data.source?.passageCount
  // Older saved injections have no count. Their source frames are still visible.
  return { text, count: typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : [...text.matchAll(/\[source: /g)].length }
}
export const retrievalDefinition = {
  kind: 'dsh-knowledge-retrieval', target: 'chat',
  match: {
    'user/message': (event: RetrievalEvent) => event.surfaceOp === 'append' && event.data.source?.kind === 'dsh-knowledge'
      ? { id: String(event.data.id ?? event.seq), role: 'start' as const, exclusive: true as const } : null,
  },
  start: (_context: unknown, match: Match) => retrievalRecord(match.event),
  update: (context: ProjectionContext) => context.state,
  buildViewNode: (context: ProjectionContext) => !context.start || !context.state ? null : ({
    key: context.key, id: context.id, kind: 'dsh-knowledge-retrieval', target: 'chat',
    anchorSeq: context.start.event.seq, location: context.start.location, visibility: 'visible', data: context.state,
  }),
}

/** Render the exact model-facing text as text, never executable source Markdown/HTML. */
export function KnowledgeRetrieval({ node }: { node: { data: ReturnType<typeof retrievalRecord> } }) {
  const { text, count } = node.data
  const sources = [...text.matchAll(/\[source: [^\]\n]*?docId=([^;\]\s]+);[^\]\n]*?chunkId=([^;\]\s]+)[^\]\n]*\]/g)]
  return <details data-knowledge-retrieval style={{ color: 'var(--dsw-alias-label-secondary, #aaa)', fontSize: 'var(--dsh-content-font-size-secondary, 13px)', margin: '4px 0 8px' }}>
    <summary style={{ cursor: 'pointer', lineHeight: '24px' }}>Knowledge retrieved — {count} {count === 1 ? 'passage' : 'passages'}</summary>
    <div style={{ marginLeft: 20 }}>
      {sources.length > 0 && <nav aria-label="Retrieved sources" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '6px 0' }}>
        {sources.map((source, index) => <a key={`${source[1]}:${source[2]}:${index}`} href={`/knowledge/documents/${encodeURIComponent(source[1])}/raw?inline=1`} target="_blank" rel="noreferrer" style={{ color: 'var(--dsw-alias-brand-primary, #80b6ff)' }}>Original {index + 1}</a>)}
      </nav>}
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflow: 'auto', padding: 12, borderRadius: 6, background: 'var(--dsw-alias-markdown-code-block, #222)', fontSize: 12, lineHeight: 1.5 }}>{text}</pre>
    </div>
  </details>
}
