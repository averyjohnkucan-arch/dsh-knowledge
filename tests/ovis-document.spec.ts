import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Config, resolveConfig } from '../src/knowledge/config.js'
import { extractDocumentContent, processorFingerprint } from '../src/knowledge/document-processing.js'
import { baseConfigSchema } from '../src/knowledge/domain.js'

const { convert, backend } = vi.hoisted(() => ({ convert: vi.fn(), backend: vi.fn(() => 'ovis-test') }))
vi.mock('dsh-knowledge/local-search', async original => ({
  ...await original<typeof import('dsh-knowledge/local-search')>(), readOcr: convert, ocrIdentity: backend,
}))
const config = resolveConfig(Config({} as Config), { documentProcessorProvider: 'ovis-local' })
const input = { config, bytes: Buffer.from('%PDF-'), fileName: 'scan', mimeType: 'application/pdf' }

describe('local OvisOCR2 import', () => {
  beforeEach(() => { convert.mockReset(); backend.mockReturnValue('ovis-test') })
  it('accepts the per-base processor and includes the backend in its cache key', () => {
    expect(baseConfigSchema.parse({documentProcessorProvider:'ovis-local'}).documentProcessorProvider).toBe('ovis-local')
    const initial = processorFingerprint(config)
    backend.mockReturnValue('another OCR revision')
    expect(processorFingerprint(config)).not.toBe(initial)
  })
  it('keeps exact Markdown, page citations and review notes for extensionless PDFs', async () => {
    const first = '# Invoice 🚲', second = 'Total **128.50**'
    const markdown = '<!-- Page 1 -->\n\n' + first + '\n\n<!-- Page 2 -->\n\n' + second + '\n'
    convert.mockResolvedValue({ status: 'complete', pages: 2, complete_pages: 2, markdown,
      review_pages: { 2: ['check numeral'] }, page_spans: [first, second].map((text,i) => ({
        page: i+1, start: markdown.indexOf(text), end: markdown.indexOf(text) + text.length,
      })) })
    const { document } = await extractDocumentContent(input)
    expect(convert).toHaveBeenCalledOnce()
    expect(convert.mock.calls[0]?.[1]).toBe('pdf')
    expect(document).toMatchObject({ text: markdown, processedPages: [0,1], provider: 'ovis-local', completeness: 'complete',
      blocks: [{ pageIndex: 0, text:first },{ pageIndex: 1, text:second }], warnings: [{ code:'ocr_review' }] })
  })
  it('stops partial OCR before chunking', async () => {
    convert.mockResolvedValue({status:'partial', pages:2, complete_pages:1, markdown:'partial'})
    await expect(extractDocumentContent(input)).rejects.toMatchObject({code:'ocr_incomplete'})
  })
  it('still imports ordinary Markdown through the existing reader', async () => {
    const result = await extractDocumentContent({ config, bytes: Buffer.from('# First\n\nBody'), fileName:'notes.md' })
    expect(result.document.text).toContain('# First')
    expect(convert).not.toHaveBeenCalled()
  })
})
