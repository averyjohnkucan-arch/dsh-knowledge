import React, { useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { MarkdownSnapshot } from '../../knowledge/markdown-snapshots.js'
import { originalSourceUrl, parseKnowledgeCitation } from '../../shared/citations.js'

interface Navigation { revision: number; params?: { href?: string; title?: string } }
interface SourceProps { useTabInfo: () => { tab: { navigation: Navigation } } }
export const SOURCE_CSS = `@keyframes kb-cite-pulse{0%,45%{background:#f5cb5588}100%{background:#f5cb5528}}
.kb-cited{animation:kb-cite-pulse 1.8s ease-out;background:#f5cb5528;border-left:3px solid #ce9b13}
.kb-source-line{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.7 monospace;padding:2px 6px}
.kb-line-number{display:inline-block;min-width:3.5em;opacity:.6;user-select:none}
a[href*="/knowledge/documents/"][href*="#citation"]:not([data-knowledge-source-external]){display:inline-block;vertical-align:baseline;max-width:100%;padding:.08em .45em;margin:0 .18em;border:1px solid #8884;border-radius:.4em;background:#8882;color:inherit;font-size:.78em;line-height:1.5;overflow-wrap:anywhere;text-decoration:none}
a[href*="/knowledge/documents/"][href*="#citation"]:not([data-knowledge-source-external]):hover{text-decoration:underline}
@media(prefers-reduced-motion:reduce){.kb-cited{animation:none}}`

/** Uses the tab's persisted navigation, so sessions and repeated clicks stay independent. */
export function KnowledgeSource({ useTabInfo }: SourceProps) {
  const { tab } = useTabInfo(), nav = tab.navigation
  const href = nav.params?.href ? parseKnowledgeCitation(nav.params.href, window.location.origin) : undefined
  const [result, setResult] = useState<{ href: string; snapshot: MarkdownSnapshot }>()
  const [error, setError] = useState('')
  const target = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setResult(undefined); setError('')
    if (!href) return
    const controller = new AbortController(), url = new URL(href, window.location.origin)
    url.hash = ''; url.searchParams.set('format', 'json')
    void fetch(url, { signal: controller.signal, credentials: 'same-origin' }).then(async response => {
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error?.message ?? 'Source unavailable')
      if (!controller.signal.aborted) setResult({ href, snapshot: body.value })
    }).catch(e => { if (!controller.signal.aborted) setError(String(e.message)) })
    return () => controller.abort()
  }, [href, nav.revision])
  const snapshot = result?.href === href ? result?.snapshot : undefined
  const url = href ? new URL(href, window.location.origin) : undefined
  const chunkId = url?.searchParams.get('chunk') ?? url?.pathname.split('/').pop()
  const passage = snapshot?.passages.find(row => row.chunkId === chunkId)
  useEffect(() => {
    if (snapshot) target.current?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [snapshot, nav.revision])
  const ranges = passage?.ranges ?? [], lines = snapshot?.text.split('\n') ?? []
  const first = ranges[0]?.lineStart ?? 1, last = ranges.at(-1)?.lineEnd ?? first
  const start = Math.max(0, first - 201), end = Math.min(lines.length, last + 200)
  return <section aria-label="Knowledge source" style={{ height: '100%', padding: 16, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
    {!href ? <p>Click a knowledge citation to see its supporting lines here.</p> : <>
      <header><h3>{snapshot?.title ?? nav.params?.title ?? 'Knowledge source'}</h3>
        <nav aria-label="Source views" style={{ display: 'flex', gap: 12, fontSize: 13 }}>
          <a href={href} target="_blank" rel="noreferrer" data-knowledge-source-external>Open Markdown</a>
          {snapshot && <a href={originalSourceUrl(snapshot.documentId)} target="_blank" rel="noreferrer">Open original</a>}
        </nav>
        {!!ranges.length && <p>Lines {first}{last !== first ? `–${last}` : ''}</p>}
        {snapshot && <small>{snapshot.revision === 'current-index' ? 'Current indexed source · cited passage verified unchanged' : 'Saved indexed source revision'}</small>}
      </header>
      {error ? <p role="alert">{error}</p> : !snapshot ? <p role="status">Loading source…</p> : !passage ? <p role="alert">This citation does not belong to this source revision.</p> :
        <div key={`${href}:${nav.revision}`} aria-label="Source text" style={{ overflow: 'auto', minHeight: 0, flex: 1, marginTop: 12 }}>
          {!ranges.length ? <><p>No exact source range could be verified for this transformed passage. Its indexed text is shown below.</p><div ref={target} className="kb-source-line">{passage.text}</div></> : <>
            {start > 0 && <p>Showing surrounding source lines {start + 1}–{end}. Open Markdown for the whole file.</p>}
            {lines.slice(start, end).map((line, n) => { const index = start + n + 1
              const cited = ranges.some(range => index >= range.lineStart && index <= range.lineEnd)
              return <div key={index} data-line={index} ref={index === first ? target : undefined} className={`kb-source-line${cited ? ' kb-cited' : ''}`}><span className="kb-line-number">{index}</span>{line}</div>
            })}
          </>}
        </div>}
    </>}
  </section>
}

export function installKnowledgeSource(ctx: Context): void {
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], scope => {
    const sidebar = (scope as unknown as { sidebarRight: unknown }).sidebarRight as { mounted: { getSnapshot(): unknown }; openTab(kind: string, options: { params: { href: string; title: string } }): void }
    const tabs = (scope as unknown as { sidebarRightTabs: unknown }).sidebarRightTabs as { register(value: unknown): () => void }
    const slots = (scope as unknown as { slots: unknown }).slots as { inject(name: string, callback: () => void): void; register(options: unknown, component: unknown): unknown }
    const id = 'dsh-knowledge-source'
    scope.effect(() => tabs.register({ id, kind: id, title: () => 'Source', guide: [] }))
    slots.inject('sidebar.right.pane.tab', () => slots.register({ name: 'sidebar.right.pane.tab', key: id }, KnowledgeSource))
    scope.effect(() => {
      const style = document.createElement('style'); style.textContent = SOURCE_CSS; document.head.append(style)
      const click = (event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
        const anchor = (event.target as Element)?.closest?.('a[href]')
        if (!anchor || anchor.hasAttribute('data-knowledge-source-external')) return
        const destination = anchor.getAttribute('href') ?? ''
        try {
          const original = new URL(destination, window.location.origin)
          if (original.origin === window.location.origin && /^\/knowledge\/documents\/[A-Za-z0-9_-]+\/raw$/.test(original.pathname) && original.search === '?inline=1') {
            event.preventDefault(); event.stopPropagation(); window.open(original.href, '_blank', 'noopener,noreferrer'); return
          }
        } catch { return }
        const href = parseKnowledgeCitation(destination, window.location.origin)
        if (!href || !sidebar.mounted.getSnapshot()) return
        sidebar.openTab(id, { params: { href, title: anchor.textContent ?? 'Knowledge source' } })
        event.preventDefault(); event.stopPropagation()
      }
      document.addEventListener('click', click, true)
      return () => { style.remove(); document.removeEventListener('click', click, true) }
    })
  })
}
