/** Keep help focused on user-visible effects and when saved data needs refreshing. */
export const SETTINGS_HELP = {
  ocr: `OCR recognizes words drawn into scanned page images when ordinary text extraction is insufficient. It makes otherwise unreadable pages searchable, but takes more processing time and can misread faint, skewed, or complex layouts.

Enable it for scanned PDFs and make sure the OCR models are installed. It affects future parsing; changing this switch does not automatically replace text already extracted from existing documents.`,
  processingTimeout: `This is the maximum allowed time for document processing, in milliseconds. Large scans or complex layouts may need a longer allowance than ordinary text files. Increasing it gives slow work more time to finish; it does not make processing faster.

A shorter limit can report stuck or unusually slow work sooner, but may interrupt valid large documents. Timed-out items can be retried after adjusting the limit.`,
  structuredChunking: `Structure-aware chunking tries to keep meaningful document elements, such as tables, formulas, and their captions, together instead of cutting only by text length. This can preserve relationships the model needs to answer accurately.

It may produce less uniform chunk sizes and depends on the structure available from the parser. Changes affect newly processed content; use Rechunk saved parsing result to apply them to existing saved text and structure.`,
  embeddingProvider: `An embedding model turns each searchable chunk into a vector: a list of numbers representing its meaning. The same model and dimensions must encode your question and the stored chunks for meaningful similarity scores. Disabled keeps keyword search available.

Choose a downloaded local model for offline processing, or an endpoint for remote embeddings. Changing the model can invalidate existing vectors; the panel explains whether it can migrate in place or needs a rebuild. Saving batch size alone does not change the meaning of stored vectors.`,
  dimensions: `Dimensions are the numbers inside each vector, not the number of documents or search results. Qwen3 Embedding 0.6B supports 32–1024 dimensions; its native default is 1024. Smaller vectors reduce vector storage, memory use, and similarity-search work, but may lose useful detail. They do not shrink the model or avoid its inference work.

For example, 512 dimensions uses half the raw vector bytes of 1024. Saving a different width starts background re-vectorization from saved chunks. Old-width vectors are excluded until replaced; keyword retrieval remains available. Models without supported dimension reduction keep their native output.`,
  batchSize: `This is the maximum number of chunks submitted together during indexing. Larger batches can improve throughput by sharing model and request overhead, but need more memory and can increase latency. Smaller batches use less memory and can be useful for long chunks or limited hardware.

The backend may split this upper limit into smaller device batches to respect memory, token length, and foreground inference priority. Changing it affects subsequent work and does not require rebuilding existing vectors. It does not control how many search results are returned.`,
  topK: `Top K limits the matching chunks returned by a knowledge search after ranking. A higher value can provide broader evidence, but adds retrieval work and potentially more text for the model to read. A lower value is faster and more focused, with a greater chance of omitting a useful passage.

This is a result count, not vector dimensions. Automatic injection also respects its own total passage budget and each base's retrieval weight, so increasing Top K does not guarantee that many passages enter every chat. This setting takes effect on future lookups without re-embedding.`,
  searchMode: `Hybrid combines keyword matches with embedding similarity. Vector search looks for similar meaning and can find paraphrases that share few words; lexical search uses the text index and is useful for exact names, codes, and identifiers. Auto lets the available retrieval paths determine the result.

Vector search needs compatible stored embeddings. If the embedding service is unavailable, the plugin can fall back to lexical retrieval. Choosing a search mode changes future lookups without rewriting your documents.`,
  rrfVectorWeight: `Hybrid search combines two ranked lists: keyword results and vector results. This weight controls the vector list's relative contribution; 1 balances the two, a higher value gives semantic matches more influence, and a lower value favors keyword matches. It is not a similarity threshold or a percentage.

Increase it when paraphrased concepts are being missed; decrease it when exact terms matter more. It affects hybrid ranking only, does not create extra vectors, and applies to future searches without reindexing.`,
  diversity: `Maximal marginal relevance (MMR) balances relevance against similarity to already selected passages. Zero disables it. Among enabled values, smaller numbers penalize repetition more strongly; larger numbers favor the original relevance score. At 1, relevance dominates.

MMR needs compatible embeddings and can help broad questions cover distinct evidence. Too much diversity may admit weaker matches. Changing this setting affects future searches without rebuilding vectors.`,
  threshold: `When a reranker is configured, this is the minimum reranker score a result must meet. Raising it can remove weak evidence, but may leave few or no results. Lowering it admits more uncertain matches.

Scores depend on the reranker and are not universal probabilities. Tune against your own questions; this setting affects future searches without changing stored vectors.`,
  siblingChunks: `Neighboring chunks extend a selected hit with nearby text from the same document, helping preserve context that a single chunk may omit. Zero keeps only the selected chunk; higher values can include surrounding explanation.

More neighbors increases the amount of text returned and can consume more chat context. It does not increase vector dimensions or require re-embedding.`,
  semanticChunk: `Semantic merging uses embeddings to group nearby text segments with similar meaning instead of relying only on size and separators. It can create more coherent passages, but needs extra embedding work during chunk construction.

Saving this option does not immediately rebuild every existing document. Use Rechunk saved parsing result to apply it to saved text without repeating OCR; changed chunks then need new vectors.`,
  semanticChunkThreshold: `This controls how similar neighboring segments must be before semantic merging joins them. A higher threshold makes merging more selective, often retaining more small chunks. A lower threshold merges more freely, up to the chunk budget.

It trades fine-grained matches against broader context. Rechunk saved parsing result applies a new threshold to existing documents; ordinary retrieval settings do not change chunk boundaries.`,
  semanticCandidates: `Nearby short paragraphs within the same heading can be grouped before semantic comparison. Larger candidate groups reduce the number of embedding comparisons and often speed up chunking, but give merging less fine-grained control. Zero compares individual paragraphs.

The candidate size cannot exceed the chunk size. Applying a new value to existing documents requires rechunking saved parsing results.`,
  smartChunk: `Smart chunking tries to split text at natural boundaries such as paragraphs and sentences rather than cutting strictly at a fixed size. This can keep related ideas together and improve the readability of retrieved passages.

Chunk size remains a target budget. Saving this setting affects newly processed content; rechunk saved parsing results to apply it to existing documents.`,
  chunkSize: `Chunk size is the target token budget for each searchable passage. Smaller chunks produce more focused matches and usually more vectors; larger chunks keep more context but can dilute a specific match and send more text into the chat.

The plugin estimates tokens rather than matching every model tokenizer exactly. Use Rechunk saved parsing result to apply a new size to existing content. Changing boundaries invalidates vectors for the affected chunks, but does not require repeating OCR.`,
  chunkOverlap: `Overlap repeats some text at neighboring chunk boundaries so an idea split across two chunks is less likely to be lost. It must be smaller than the chunk size. More overlap provides continuity but creates more duplicate text, vectors, storage, and embedding work.

Start with a small fraction of the chunk size and increase only if boundary-related misses are common. Existing documents need rechunking for the new overlap to take effect.`,
  autoRetrieve: `Automatic retrieval searches enabled knowledge bases when a user message arrives and injects selected evidence into the model's context. It can help the model use your material without first making a manual knowledge-search call.

It also adds lookup latency and consumes context. Disable it for a base when its material is unrelated to most conversations; the knowledge search tools can still be used explicitly.`,
  autoRetrieveWeight: `This is the base's passage allocation weight for automatic retrieval, on a 0–5 scale. Zero excludes the base from automatic injection. Larger values allow it more of the available passage budget relative to the other selected bases.

The overall injection budget still applies, so this is not a guarantee of an exact count. It does not change vector dimensions or ranking within the stored index.`,
  rerankModel: `A reranker reads the question together with retrieved passages and scores their relevance again. This can improve the final ordering beyond keyword and embedding matches, especially when the initial candidates are similar.

It adds a separate inference step, memory use, and latency. A downloaded local reranker avoids remote calls; leaving it disabled uses the initial ranking. Changing the reranker does not rebuild the embedding index.`,
  docProcessing: `The document processor extracts searchable text and structure from your source files. Ordinary text extraction is fastest for text-based files; scanned pages need OCR, and more advanced processors can recover layout, tables, and figures.

Processing choices affect import cost and the quality of the saved text. Rechunking only changes passages from that saved text; use Reindex when you need the source parsed again with a different processor.`,
  imageCaption: `Captioning adds descriptions of images or chart/table content so material absent from ordinary text extraction can become searchable. It can improve coverage for visual documents, but adds model inference and may produce imperfect descriptions.

Choose a provider suited to the material. Chart/table parsing extracts structure; photographic descriptions need a vision provider. Reprocessing or enrichment is needed for existing content to gain new descriptions.`,
  chunkTokenLimit: `This adds a token ceiling for each chunk. Oversized chunks are split further at preferred boundaries so embedding inputs stay within the model's context window. Zero disables this extra refinement; it does not discard the rest of a document.

A smaller ceiling creates more chunks and embedding requests, but can prevent overlong inputs. Use Rechunk saved parsing result to apply a changed ceiling to existing content.`,
  conflictStrategy: `This controls what happens when imported content conflicts with an existing item: keep the previous item, replace it with the new import, or keep both under different names. It determines whether an import overwrites or duplicates indexed material.

Choose replace for deliberate updates, keep to avoid replacing existing data, and rename when both versions matter. It affects future imports, not existing search rankings.`,
  urlRefreshHours: `This controls the refresh interval for URL sources. A shorter interval can keep changing pages fresher but uses more network requests and may trigger additional processing when content changes.

A longer interval reduces background work. This setting concerns URL sources; external folders use their separate reconciliation interval.`,
  resumeInterrupted: `On startup, interrupted processing can resume from retained documents and saved work. This helps a large import recover after the application closes instead of requiring every item to be added again.

Resuming may immediately consume CPU, accelerator, and disk resources. Disabling recovery leaves interrupted items for a deliberate retry rather than starting that work automatically.`,
  injectUsagePrompt: `This includes instructions that tell the model how to use retrieved knowledge and cite its sources. It helps the model treat retrieved passages as reference material and keep source attribution useful.

Turning it off removes that guidance from future prompts but does not delete the knowledge base or its vectors. Model behavior and citation quality may become less consistent.`,
  chunkSeparator: `The separator is a preferred text boundary used while splitting documents. Paragraph breaks are usually a useful default; a custom separator can suit consistently structured material.

A separator that rarely appears may force more size-based splits. A very frequent separator can produce many fragments. Rechunk saved parsing results to apply a different separator to existing documents.`,
} satisfies Record<string, string>
