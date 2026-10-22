# Text first, optional charts after indexing

Enable `deferredChartEnrichment` to keep detailed chart/table reconstruction out of the import's critical path. Set `imageCaptionProvider: off` for text-only initial imports, or select a vision provider for brief image descriptions. When the provider is `paddle`, enabling deferred charts skips its inline enrichment pass.

The optional chart worker starts after imports and vectorization settle and DSH has had 30 seconds without foreground reservations. It processes one document at a time, using the existing structure scheduler for compatible device work. New foreground inference interrupts it; unfinished work can retry at a later idle interval. This is DSH workload idle detection, not keyboard/mouse idle detection.

The worker verifies that source bytes still match the saved extraction, preserves the existing text and evidence assets, appends chart/table information, and uses the existing chunk embedding cache. Only changed embedding inputs need inference. Publication replaces the document generation atomically after vectors are ready. Cancellation or failure leaves the previous searchable generation intact. Completion is keyed to the artifact revision and survives restart. Model errors are recorded as failed enrichment for that revision rather than repeatedly retrying a broken model; reprocessing the document produces a new revision eligible for another attempt.

`imageCaptionProvider: dsh` optionally uses the host LLM and attachment services. Its model identifier is `provider/model`; the selected vision model must support reasoning off. It uses host-managed startup and model leases, serializes image calls, limits output to 128 tokens, and caps each call at 120 seconds. It does not enable itself or choose a model automatically. OpenAI and Ollama captions use the same brief description prompt and output limit.

Validation: idle admission and interruption tests; service tests for enrichment merge, cancellation, and model failure; source extraction tests ensuring deferred charts never run inline; embedding reuse regression tests; TypeScript and production builds. Hardware speed and end-to-end photo-caption output are not asserted by these unit tests.

## Deferred photos

`deferredPhotoCaptions: true` enables a separate idle photo pass. Set `deferredPhotoCaptionModel` to a managed vision `provider/model` identifier. This setting is independent of the inline caption provider, so enabling it does not change the source OCR fingerprint or reparse the library. All eligible photo jobs precede the detailed chart pass. Both passes retain separate completion records and carry those records across each other's saved revisions. Brief photo output is added to saved text and indexed using the same atomic generation merge.

Managed caption inference is identified through an async call context so its own host model reservation does not cancel the optional job. Separate foreground chat calls still interrupt it. A failed image request is recorded as failed optional enrichment, rather than incorrectly marking an empty photo pass complete.
