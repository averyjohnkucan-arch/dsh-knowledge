import type { DocumentSetup, LocalSetup, SearchPreferences, VisionCatalog } from '../shared/local-setup.js'
export const embeddingId: string
export const rerankerId: string
export function hasSetup(): boolean
export function setupState(): LocalSetup
export function startSetup(onReady: () => Promise<void>, force?: boolean): Promise<LocalSetup>
export function resumeSetup(onReady: () => Promise<void>): void
export function configure(ctx: unknown, input: Partial<SearchPreferences>, onReady: () => Promise<void>): Promise<LocalSetup>
export function closeSearch(): void
export function enterForeground(): () => void
export function isDocumentVision(): boolean
export function visionCatalog(ctx: unknown): Promise<VisionCatalog>
export function embedPassages(texts: readonly string[], purpose: 'index' | 'query', signal?: AbortSignal): Promise<number[][]>
export function rankPassages(query: string, texts: readonly string[], signal: AbortSignal): Promise<number[]>
export function markdownTitle(title: string, text: string): string
export function visionFingerprint(): string
export function readVisual(ctx: unknown, bytes: Uint8Array, name: string, kind: string, signal?: AbortSignal): Promise<string | undefined>
export function documentSetupState(id: string, configured: boolean): DocumentSetup
export function startDocumentSetup(id: string, configured: boolean, apply: (id: string) => Promise<void>): DocumentSetup
export function resumeDocumentSetup(apply: (id: string) => Promise<void>): void
export function ocrIdentity(): string
export function readOcr(bytes: Uint8Array, suffix: string, signal: AbortSignal | undefined, timeout: number): Promise<{
  page_spans: { page: number; start: number; end: number }[]; status: 'complete' | 'partial'; markdown: string; pages: number; complete_pages: number; review_pages: Record<string, string[]>
}>
