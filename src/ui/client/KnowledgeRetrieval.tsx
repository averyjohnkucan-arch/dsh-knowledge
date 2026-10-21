import React from 'react'
import { DisclosureRow, IconBrowseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

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

/** Source frames are producer formatting, not user-facing prose. Never render their HTML. */
export function parseRetrievalPassages(text: string) {
  const frames = [...text.matchAll(/^\[source: ([^\]\n]+)\] ?/gm)]
  return frames.map((frame, index) => {
    const fields = frame[1].split('; ')
    const value = (name: string) => fields.find(field => field.startsWith(name + '='))?.slice(name.length + 1) ?? ''
    const title = value('title') || 'Retrieved passage'
    const heading = value('heading')
    let excerpt = text.slice(frame.index! + frame[0].length, frames[index + 1]?.index ?? text.length).trim()
    for (const label of new Set([title, heading].filter(Boolean))) excerpt = excerpt.split(`[${label}] `).join('')
    return { title, heading, base: fields[0].startsWith('baseId=') ? 'Knowledge base' : fields[0], documentId: value('docId'), chunkId: value('chunkId'), excerpt }
  })
}

export function KnowledgeRetrieval({ node, useDisclosure }: { node: { data: ReturnType<typeof retrievalRecord> }; useDisclosure: () => { expanded: boolean; toggle: () => void } }) {
  const { expanded, toggle } = useDisclosure()
  const { text, count } = node.data
  const passages = parseRetrievalPassages(text)
  const linkStyle = { color: 'var(--dsw-alias-brand-primary, #80b6ff)' }
  return <div data-knowledge-retrieval>
    <style>{`.kb-native-title{font-weight:400}.kb-native-sep{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}.kb-native-summary{color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px))}`}</style>
    <DisclosureRow icon={<IconBrowseOutlineRegular size={14} />} title="Automatic knowledge retrieval" titleClassName="kb-native-title" open={expanded} expandable expandOnRowClick keepContentWhenOpen onToggle={toggle}
      collapsedContent={<><span className="kb-native-sep" aria-hidden /><span className="kb-native-summary">{count} {count === 1 ? 'passage' : 'passages'}</span></>}>
    {expanded && <div style={{ marginLeft: 20, color: 'var(--dsw-alias-label-secondary)', fontSize: 'var(--dsh-content-font-size-secondary, 13px)' }}>
      <p style={{ margin: '6px 0 10px', lineHeight: 1.6 }}>These passages were found automatically and may or may not be relevant to your message.</p>
      {passages.length > 0 && <nav aria-label="Retrieved sources" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '6px 0 12px' }}>
        {passages.filter(p => p.documentId).map((p, index) => <a key={`${p.documentId}:${p.chunkId}:${index}`} title={p.title} href={`/knowledge/documents/${encodeURIComponent(p.documentId)}/raw?inline=1`} target="_blank" rel="noreferrer" style={linkStyle}>Original {index + 1}</a>)}
      </nav>}
      <div style={{ maxHeight: 420, overflow: 'auto', padding: '0 12px 0 0' }}>
        {passages.map((p, index) => <article key={`${p.documentId}:${p.chunkId}:${index}`} style={{ padding: '12px 0', borderTop: '1px solid var(--dsw-alias-border-l2, #3a3a3a)' }}>
          <strong style={{ color: 'var(--dsw-alias-label-primary, #ddd)', fontSize: 14 }}>{p.title}</strong>
          <div style={{ fontSize: 12, marginTop: 3, opacity: .8 }}>{p.base}{p.heading && p.heading !== p.title ? ` · ${p.heading}` : ''}</div>
          {p.excerpt.split(/\n\s*\n/).map((paragraph, i) => <p key={i} style={{ margin: '8px 0', lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', ...(paragraph.startsWith('>>> ') ? { borderLeft: '2px solid var(--dsw-alias-brand-primary, #80b6ff)', paddingLeft: 10 } : {}) }}>{paragraph.replace(/^>>> /gm, '')}</p>)}
        </article>)}
        {passages.length === 0 && <p style={{ lineHeight: 1.6 }}>{count === 0 ? 'No new passages were supplied for this question.' : 'This older retrieval has no readable source frames.'}</p>}
      </div>
    </div>}
    </DisclosureRow>
  </div>
}
