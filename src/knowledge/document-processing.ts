import { type StructureV3Manager } from './structure-v3.js'
import { createHash } from 'node:crypto'
import type { ArtifactRepository, ProcessingJobRecord } from './artifacts.js'
import type { KnowledgeConfig } from './types.js'
import type { DocumentProcessingInfo, ParsedDocument, ProcessingOutput, ProcessingProgress, ProcessingWarning } from './processing-types.js'
import { extensionOf, parseDocumentBuffer } from './parse.js'
import { extractPdfWithMineru } from './mineru.js'
import { extractWithMineruLocal } from './mineru-local.js'
import { parsedTextDocument } from './parsed-document.js'
import { retryDocument, DOCUMENT_MAX_ATTEMPTS, markAttemptsExhausted } from './document-retry.js'

let captionModule: Promise<typeof import('./caption.js')> | undefined
function loadCaptionModule() {
  return captionModule ??= import('./caption.js').catch(error => {captionModule=undefined;throw error})
}

export interface ProcessedFile {
  readonly text: string
  readonly parsed: ParsedDocument
  readonly processing: DocumentProcessingInfo
}

export function processorFingerprint(config: KnowledgeConfig): string {
  // Credentials are neither persisted nor used as an artifact identity.
  return hash(JSON.stringify({
    ocrEnabled: config.ocrEnabled !== false,
    structureV3Charts: config.structureV3Charts ?? true,
    version: 2, provider: config.documentProcessorProvider,
    host: config.documentProcessorProvider === 'mineru-local' ? config.mineruLocalUrl : config.mineruApiHost,
    tier: config.mineruTier ?? 'basic',
    caption: { provider: config.imageCaptionProvider, model: config.imageCaptionModel, host: config.imageCaptionBaseUrl },
  }))
}

function hash(bytes: Uint8Array | string): string { return createHash('sha256').update(bytes).digest('hex') }

export function processorErrorCode(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'canceled'
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && /^[a-zA-Z0-9_]{1,64}$/.test(code) ? code : 'processing_failed'
}

/** Do not copy upstream response bodies/URLs/tokens into persisted diagnostics. */
export function processorErrorMessage(error: unknown): string {
  const code = processorErrorCode(error)
  if (code === 'ocr_incomplete') return 'OCR did not process every required page; no partial text was indexed. Split the PDF or switch to MinerU, then rebuild.'
  if (['ocr_process_crash', 'ocr_timeout', 'ocr_failed'].includes(code)) return `Local OCR failed (${code}); the DSH host remains running. Check the OCR model installation or switch to MinerU, then rebuild.`
  if (code === 'ocr_busy') return 'Local OCR queue is full; retry the document later.'
  if (code === 'recovery_limit_reached') return 'Automatic document recovery stopped after 3 attempts; check the source and processor settings, then rebuild manually.'
  if (code === 'parse_failed') return 'MinerU extraction failed (provider unavailable); local parsing failed (parse_failed); check the document processor settings'
  return `document processor failed (${code}); check processor configuration and service health`
}

export interface ProcessFileInput {
  readonly managedCaption?: import('./managed-caption.js').ManagedCaption
  readonly structureV3?: StructureV3Manager
  /** Gate parsing only; optional structure enrichment must not hold parser capacity. */
  readonly runParsing?: <T>(task: () => Promise<T>) => Promise<T>
  readonly baseId: string
  readonly documentId: string
  readonly fileName: string
  readonly mimeType?: string
  readonly bytes: Uint8Array
  readonly config: KnowledgeConfig
  readonly artifacts: ArtifactRepository
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: ProcessingProgress) => void
  /** Startup-only recovery, never silently reuse artifacts for explicit reparse. */
  readonly resume?: boolean
  /** Validated output from the import-wide extraction/parsing stages. */
  readonly prepared?: ProcessingOutput
}

/** All file entry points use this function. Cloud is only contacted when the
 * user explicitly selected the legacy cloud provider (never as local fallback). */
export async function processDocumentFile(input: ProcessFileInput): Promise<ProcessedFile> {
  try {
    return await retryDocument(attempt => processDocumentFileAttempt(input, attempt), { signal: input.signal })
  } catch (error) {
    // Cancellation during backoff also settles the durable job immediately.
    if (input.signal?.aborted) {
      const job = await input.artifacts.getJob(input.baseId, input.documentId)
      if (job?.state === 'running') await input.artifacts.saveJob({ ...job, state: 'canceled', progress: { stage: 'canceled' }, updatedAt: Date.now() }).catch(() => {})
    }
    throw error
  }
}

async function processDocumentFileAttempt(input: ProcessFileInput, attempt: number): Promise<ProcessedFile> {
  input.signal?.throwIfAborted()
  const { config, bytes, artifacts, baseId, documentId } = input
  const sourceHash = hash(bytes)
  const fingerprint = processorFingerprint(config)
  const previous = input.resume ? await artifacts.getJob(baseId, documentId) : undefined
  const matching = previous?.sourceHash === sourceHash && previous.fingerprint === fingerprint ? previous : undefined
  if (matching?.state === 'completed' && matching.artifact !== undefined) {
    const parsed = await artifacts.load(baseId, documentId, matching.artifact)
    return { text: parsed.text, parsed, processing: { ...matching.artifact, reused: true } }
  }
  if (matching?.errorCode === 'submission_unknown') throw Object.assign(new Error('previous submission outcome is unknown; explicitly reparse to retry'), { code: 'submission_unknown' })
  if (matching !== undefined && (matching.startupAttempts ?? 0) >= 3) {
    await artifacts.saveJob({ ...matching, state: 'failed', errorCode: 'recovery_limit_reached', progress: { stage: 'failed' }, updatedAt: Date.now() })
    throw Object.assign(new Error('automatic document recovery limit reached; rebuild manually'), { code: 'recovery_limit_reached' })
  }
  let job: ProcessingJobRecord = {
    version: 1, baseId, documentId, sourceHash, fingerprint, state: 'running',
    attempt,
    progress: { stage: 'checking' }, updatedAt: Date.now(),
    startupAttempts: input.resume ? (matching?.startupAttempts ?? 0) + 1 : 0,
  }
  await artifacts.saveJob(job)
  let progressWrite: Promise<void> = Promise.resolve()
  let pendingProgress: ProcessingJobRecord | undefined
  let progressTimer: ReturnType<typeof setTimeout> | undefined
  const flushProgress = (): Promise<void> => {
    if (progressTimer) clearTimeout(progressTimer)
    progressTimer = undefined
    if (pendingProgress) {
      const snapshot = pendingProgress
      pendingProgress = undefined
      progressWrite = progressWrite.then(() => artifacts.saveJob(snapshot))
      void progressWrite.catch(() => {})
    }
    return progressWrite
  }
  const progress = (value: ProcessingProgress): void => {
    const newExternalId = value.jobId !== undefined && value.jobId !== job.progress.jobId
    const retainedId = value.jobId ?? job.progress.jobId ?? matching?.progress.jobId
    job = { ...job, progress: { ...value, ...(retainedId !== undefined ? { jobId: retainedId } : {}) }, updatedAt: Date.now() }
    // Keep the external id even after download/normalization stage events.
    pendingProgress = job
    // Live UI progress stays immediate. Coalesce diagnostic checkpoints, but
    // persist a newly assigned remote job ID immediately for restart recovery.
    if (newExternalId) void flushProgress()
    else if (!progressTimer) progressTimer = setTimeout(() => { void flushProgress() }, 1000)
    input.onProgress?.(value)
  }
  try {
    let output: ProcessingOutput
    const parse = () => extractDocumentContent({ ...input,
      resumeJobId: matching?.state === 'running' ? matching.progress.jobId : undefined,
      onProgress: progress,
    })
    if (input.prepared) {
      if (input.prepared.document.sourceHash !== sourceHash || input.prepared.document.optionsFingerprint !== fingerprint)
        throw Object.assign(new Error('Prepared document no longer matches its source or settings'), {code:'prepared_source_changed'})
      output = input.prepared
    } else {
      output = await (input.runParsing ? input.runParsing(parse) : parse())
      output = await enrichDocumentContent(input, output, progress)
    }
    if (!output.document.text.trim()) throw Object.assign(new Error('parsed document is empty'), { code: 'empty_result' })
    input.signal?.throwIfAborted()
    output = { ...output, document: { ...output.document, optionsFingerprint: fingerprint } }
    progress({ stage: 'normalizing' })
    await flushProgress()
    const processing = await artifacts.save(baseId, documentId, output)
    input.signal?.throwIfAborted()
    await artifacts.saveJob({ ...job, state: 'completed', artifact: processing, progress: { stage: 'completed' }, updatedAt: Date.now() })
    return { text: output.document.text, parsed: output.document, processing }
  } catch (error) {
    await flushProgress().catch(() => {})
    const canceled = input.signal?.aborted === true
    const uncertain = ['submission_unknown', 'job_lost'].includes(processorErrorCode(error))
    const recoveryExhausted = input.resume && (job.startupAttempts ?? 0) >= DOCUMENT_MAX_ATTEMPTS
    const retrying = !canceled && !uncertain && !recoveryExhausted && attempt < DOCUMENT_MAX_ATTEMPTS
    await artifacts.saveJob({ ...job, state: canceled ? 'canceled' : retrying || uncertain ? 'running' : 'failed', errorCode: processorErrorCode(error), progress: { ...job.progress, stage: canceled ? 'canceled' : retrying ? 'queued' : uncertain ? job.progress.stage : 'failed' }, updatedAt: Date.now() }).catch(() => {})
    if (recoveryExhausted && typeof error === 'object' && error !== null) throw markAttemptsExhausted(error)
    throw error
  }
}

/** Source decoding/OCR without table/chart inference or artifact publication.
 * PDF decoding is a prerequisite for selecting and rendering OCR pages. */
export async function extractDocumentContent(input: Pick<ProcessFileInput,
  'bytes' | 'fileName' | 'mimeType' | 'config' | 'signal' | 'onProgress'> & {resumeJobId?: string}): Promise<ProcessingOutput> {
  const {config, bytes} = input
  const fingerprint = processorFingerprint(config)
  const pdf = extensionOf(input.fileName) === 'pdf'
  const warnings: ProcessingWarning[] = []
  const progress = (value: ProcessingProgress) => input.onProgress?.(value)
  let output: ProcessingOutput | undefined
  input.signal?.throwIfAborted()

      let remoteFailure: unknown
      if (pdf && config.documentProcessorProvider === 'mineru-local') {
        try {
          output = await extractWithMineruLocal(bytes, input.fileName, {
            apiUrl: config.mineruLocalUrl ?? 'http://127.0.0.1:8000',
            apiKey: config.mineruLocalApiKey,
            tier: config.mineruTier ?? 'basic',
            timeoutMs: config.documentProcessingTimeoutMs ?? 1_800_000,
          }, {
            signal: input.signal, onProgress: progress,
            ...(input.resumeJobId !== undefined ? { resumeJobId: input.resumeJobId } : {}),
          })
        } catch (error) {
          input.signal?.throwIfAborted()
          if (['job_lost', 'submission_unknown'].includes(processorErrorCode(error))) throw error
          remoteFailure = error
        }
      } else if (pdf && config.documentProcessorProvider === 'mineru') {
        if (config.mineruApiKey.trim() === '') {
          remoteFailure = Object.assign(new Error('MinerU cloud requires a key'), { code: 'configuration_missing' })
        } else {
          try {
            progress({ stage: 'parsing' })
            const text = await extractPdfWithMineru(bytes, input.fileName, { apiHost: config.mineruApiHost, apiKey: config.mineruApiKey }, input.signal)
            output = parsedTextDocument(text, bytes, 'mineru', fingerprint)
          } catch (error) { input.signal?.throwIfAborted(); remoteFailure = error }
        }
      }
      if (output === undefined) {
        if (remoteFailure !== undefined) warnings.push({ code: 'processor_fallback', message: `${processorErrorMessage(remoteFailure)}; used built-in local parsing` })
        progress({ stage: 'parsing' })
        try {
          const text = await parseDocumentBuffer(bytes, input.fileName, input.mimeType, { ocrEnabled: config.ocrEnabled })
          input.signal?.throwIfAborted()
          output = parsedTextDocument(text, bytes, 'builtin', fingerprint, warnings)
        } catch (error) {
          input.signal?.throwIfAborted()
          if (remoteFailure !== undefined) throw Object.assign(new Error(`MinerU extraction failed (${processorErrorCode(remoteFailure)}); local parsing failed (${processorErrorCode(error)})`), { code: 'parse_failed' })
          throw error
        }
      }
      return output

}

/** Parsing/enrichment consumes completed extraction; it never reruns OCR of
 * the source PDF through parseDocumentBuffer. Structure models retain their
 * own internal recognition where required to interpret a table or chart. */
export async function enrichDocumentContent(input: Pick<ProcessFileInput,
  'bytes' | 'fileName' | 'config' | 'signal' | 'structureV3' | 'managedCaption'>, output: ProcessingOutput,
  progress: (value: ProcessingProgress) => void = () => {}): Promise<ProcessingOutput> {
  const {config, bytes} = input
  const pdf = extensionOf(input.fileName) === 'pdf'
  input.signal?.throwIfAborted()
  if (!output.document.text.trim()) throw Object.assign(new Error('parsed document is empty'), { code: 'empty_result' })
    // Captioning remains opt-in, but now runs identically on import and reparse.
    if (pdf && config.imageCaptionProvider !== 'off' && !(config.deferredPhotoCaptions && config.imageCaptionProvider !== 'paddle') && !(config.deferredChartEnrichment && config.imageCaptionProvider === 'paddle')) {
      progress({ stage: 'enriching' })
      try {
        const { captionPdfImages } = await loadCaptionModule()
        input.signal?.throwIfAborted()
        const caption = await captionPdfImages(bytes, {
          managedCaption: input.managedCaption,
          structureV3: input.structureV3, signal: input.signal, charts: config.structureV3Charts,
          provider: config.imageCaptionProvider, model: config.imageCaptionModel,
          baseUrl: config.imageCaptionBaseUrl, apiKey: config.imageCaptionApiKey,
          embeddingBaseUrl: config.embeddingBaseUrl,
        })
        input.signal?.throwIfAborted()
        if (caption.trim()) {
          const start = output.document.text.length + 2
          output = { ...output, document: { ...output.document,
            text: `${output.document.text}\n\n${caption}`,
            blocks: [...output.document.blocks, { id: 'generated-caption', index: output.document.blocks.length, type: 'caption', text: caption, textStart: start, textEnd: start + caption.length }],
            warnings: [...output.document.warnings, { code: 'generated_caption', message: config.imageCaptionProvider === 'paddle' ? 'Chart/table data was extracted by PP-StructureV3; verify values against the original.' : 'Image descriptions are model-generated, not verbatim source text.' }],
          } }
        }
      } catch (error) {
        input.signal?.throwIfAborted()
        output = { ...output, document: { ...output.document, warnings: [...output.document.warnings, { code: 'caption_failed', message: processorErrorMessage(error) }] } }
      }
    }

  input.signal?.throwIfAborted()
  return output
}
