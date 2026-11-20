import type { LocalSetup, SearchPreferences, VisionCatalog } from '../shared/local-setup.js'
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
