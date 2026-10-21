import { createHash } from 'node:crypto'
import { processorFingerprint } from './document-processing.js'
import type { KnowledgeConfig } from './types.js'
/** Only inputs that affect parsing, chunks, vectors or retained indexed text. */
export function indexingSettingsFingerprint(config:KnowledgeConfig):string{
  return createHash('sha256').update(JSON.stringify({version:1,processor:processorFingerprint(config),structured:config.structuredChunking!==false,smart:config.smartChunk,separator:config.chunkSeparator,size:config.chunkSize,overlap:config.chunkOverlap,tokenLimit:config.chunkTokenLimit,semantic:config.semanticChunk,semanticThreshold:config.semanticChunkThreshold,candidateTokens:config.semanticChunkCandidateTokens??128,embedding:{provider:config.embeddingProvider,model:config.embeddingModel,host:config.embeddingBaseUrl},keepInternalMarkdown:config.keepInternalMarkdown??false})).digest('hex')
}
