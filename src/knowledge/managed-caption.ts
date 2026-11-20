import { AsyncLocalStorage } from 'node:async_hooks'
const captionContext = new AsyncLocalStorage<boolean>()
/** Distinguish our own managed inference from a foreground chat reservation. */
export const isManagedCaptionCall = (): boolean => captionContext.getStore() === true

import { ProcessingQueue } from './processing-queue.js'

export type ManagedCaption = (png: Uint8Array, model: string, prompt: string, signal?: AbortSignal) => Promise<string>
/** Optional host services: the host adapter owns model startup and scheduler leases. */
interface CaptionHost {
  get(name: string): unknown
}
interface AttachmentHost { saveImage(input: {data: Uint8Array; mediaType: 'image/png'; name: string}): Promise<unknown> }
interface LlmHost {
  stream(options: {
    provider: string; model: string; reasoningEffort: string; maxTokens: number;
    messages: Array<{role: 'user'; content: Array<{type: 'text'; text: string} | {type: 'image'; attachment: unknown}>}>;
    signal: AbortSignal;
  }): AsyncIterable<{type: string; text?: string; reason?: {kind: string}}>
}

/** One short request at a time; don't queue a corpus of image requests in the model server. */
export function createManagedCaption(host: CaptionHost): ManagedCaption {
  const queue = new ProcessingQueue(1)
  return async (png, modelId, prompt, parentSignal) => {
    const separator = modelId.indexOf('/')
    if (separator < 1 || separator === modelId.length - 1) throw new Error('Managed caption model must be provider/model')
    const signal = parentSignal ?? new AbortController().signal
    return queue.run(() => captionContext.run(true, async () => {
      const llm = host.get('llm') as LlmHost | undefined
      const attachments = host.get('attachments') as AttachmentHost | undefined
      if (!llm || !attachments) throw new Error('Managed captioning needs the DSH LLM and attachment services')
      const deadline = AbortSignal.timeout(120_000)
      const requestSignal = AbortSignal.any([signal, deadline])
      requestSignal.throwIfAborted()
      const attachment = await attachments.saveImage({data: png, mediaType: 'image/png', name: 'document-image.png'})
      requestSignal.throwIfAborted()
      let text = ''
      let finished = false
      for await (const chunk of llm.stream({
        provider: modelId.slice(0, separator), model: modelId.slice(separator + 1),
        reasoningEffort: 'off', maxTokens: 128, signal: requestSignal,
        messages: [{role: 'user', content: [{type: 'text', text: prompt}, {type: 'image', attachment}]}],
      })) {
        requestSignal.throwIfAborted()
        if (chunk.type === 'text-delta') text += chunk.text ?? ''
        if (chunk.type === 'finish') {
          if (!['stop', 'max-tokens'].includes(chunk.reason?.kind ?? '')) throw new Error('Managed caption generation failed')
          finished = true
        }
      }
      requestSignal.throwIfAborted()
      if (!finished || !text.trim()) throw new Error('Managed caption response was incomplete or empty')
      return text.trim()
    }), signal)
  }
}
