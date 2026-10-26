import { createHash } from 'node:crypto'
import type { Events } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
type RequestMessage = Parameters<Events['llm/stream']>[0]['messages'][number]
type StreamChunk = ReturnType<Events['llm/stream']> extends AsyncIterable<infer T> ? T : never
import { parseKnowledgeCitation, originalSourceUrl } from '../shared/citations.js'

/** Content-addressed handles: no session-global counter or mutable source registry. */
export function citationHandle(url: string): string {
  const parsed = new URL(url, 'http://knowledge.local')
  return createHash('sha256').update(parsed.pathname + parsed.search + parsed.hash).digest('hex').slice(0, 16)
}
export function citationDefinition(url: string): string {
  return `[citation-ref:${citationHandle(url)} url=${url}] [[cite:${citationHandle(url)}]]`
}

/** Only our injected messages and results of knowledge tools can introduce handles. */
export function requestCitations(messages: readonly RequestMessage[], origin: string): Map<string, string> {
  const calls = new Set<string>(), refs = new Map<string, string>()
  for (const message of messages) {
    for (const block of message.content) {
      if (message.role === 'assistant' && block.type === 'tool-call' && /^knowledge_(search|get_document|read_document|read_evidence)$/.test(block.name)) calls.add(block.id)
    }
    const source = message.source as { kind: string } | undefined
    if (source?.kind !== 'dsh-knowledge' && !(message.role === 'tool' && calls.has(message.source.callId))) continue
    for (const block of message.content) {
      if (block.type !== 'text') continue
      for (const match of block.text.matchAll(/\[citation-ref:([a-f0-9]{16}) url=([^\s\]]+)\]/g)) {
        const path = parseKnowledgeCitation(match[2], origin)
        if (path && citationHandle(path) === match[1]) refs.set(match[1], path)
      }
    }
  }
  return refs
}

/** A bounded incremental decoder. Partial hooks never flash into the live answer. */
export class CitationDecoder {
  private pending = ''
  private code = ''
  private lineStart = true
  private escaped = false
  constructor(private resolve: (id: string) => string | undefined) {}
  push(text: string, final = false): string {
    this.pending += text
    let out = ''
    while (this.pending) {
      const char = this.pending[0]
      if (!this.escaped && (char === '`' || char === '~' && this.lineStart)) {
        const run = new RegExp(`^${char === '`' ? '`' : '~'}+`).exec(this.pending)![0]
        if (!final && run.length === this.pending.length) break
        if (char === '`' || run.length >= 3) {
          if (!this.code) this.code = run
          else if (run === this.code || this.code.length >= 3 && run[0] === this.code[0] && run.length >= this.code.length) this.code = ''
        }
        out += run; this.pending = this.pending.slice(run.length); this.lineStart = false; continue
      }
      if (!this.code && !this.escaped && char === '[') {
        const prefix = '[[cite:'
        if (!final && prefix.startsWith(this.pending)) break
        if (this.pending.startsWith(prefix)) {
          const end = this.pending.indexOf(']]', prefix.length)
          if (end < 0 && !final && this.pending.length <= 25) break
          if (end >= 0) {
            const token = this.pending.slice(prefix.length, end)
            out += /^[a-f0-9]{16}$/.test(token) ? this.resolve(token) ?? '[Source unavailable]' : '[Invalid citation]'
            this.pending = this.pending.slice(end + 2); this.lineStart = false; continue
          }
        }
      }
      out += char; this.pending = this.pending.slice(1)
      this.lineStart = char === '\n' || this.lineStart && (char === ' ' || char === '\t')
      this.escaped = char === '\\' && !this.escaped
    }
    return out
  }
}

/** Transform visible text only; tool arguments, reasoning and usage stay untouched. */
export async function* resolveCitationStream(stream: AsyncIterable<StreamChunk>, resolve: (id: string) => string | undefined): AsyncIterable<StreamChunk> {
  const decoders = new Map<number, CitationDecoder>()
  const decoder = (index: number) => { let item = decoders.get(index); if (!item) { item = new CitationDecoder(resolve); decoders.set(index, item) } return item }
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') {
      const text = decoder(chunk.index).push(chunk.text)
      if (text) yield { ...chunk, text }
    } else if (chunk.type === 'block-end' && chunk.block.type === 'text') {
      const tail = decoders.get(chunk.index)?.push('', true)
      if (tail) yield { type: 'text-delta', index: chunk.index, text: tail }
      decoders.delete(chunk.index)
      yield { ...chunk, block: { ...chunk.block, text: new CitationDecoder(resolve).push(chunk.block.text, true) } }
    } else {
      if (chunk.type === 'finish') {
        for (const [index, item] of decoders) { const text = item.push('', true); if (text) yield { type: 'text-delta', index, text } }
        decoders.clear()
      }
      yield chunk
    }
  }
}

export function resolvedCitation(label: string, path: string, origin: string): string {
  const documentId = path.split('/')[3]
  const safe = label.replace(/[\\\[\]<>\r\n\t`]/g, ' ').slice(0, 240)
  return `[${safe}](${new URL(path, origin).href})\u2060[Original ↗](${originalSourceUrl(documentId, origin)})`
}
