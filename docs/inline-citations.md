# Inline knowledge citations

The model emits a short `[[cite:0123456789abcdef]]` hook next to a supported claim. Evidence producers supply content-addressed reference definitions. The LLM stream middleware resolves only definitions supplied by Knowledge injection or results of recognized Knowledge tool calls in that request. It checks same-origin URLs, reference digests and current document/base access; missing references become an explicit source-unavailable marker rather than fabricated links. There is no shared session counter or mutable global reference registry.

The complete citation policy lives once in the Knowledge system-prompt section. Automatic retrieval and explicit search, chunk/context reads, structured-evidence reads, and text/regex reads carry a short reminder. The model still chooses relevant evidence; software cannot guarantee semantic support for every generated claim.

The incremental decoder buffers partial hooks across arbitrary token boundaries. It leaves code, reasoning, tool arguments, usage, and finish metadata intact. Both live text and completed text blocks receive the same resolved links, so saved conversations reopen without needing a reference registry. Ordinary older Markdown citations remain supported.

Resolved citations use two independent links styled as one compact box: the source title and a blue underlined `Original ↗`. Web URLs are absolute because DSH 0.2 treats relative Markdown links as local files. The plugin opens passage links through the native right sidebar, with line numbers, verified highlighting, scrolling, and a 1.8-second pulse. Reduced-motion preferences disable animation. Original links open separately.

Retained Markdown uses immutable saved revisions. Without retention, chunk citations verify the chunk ID and SHA-256 against the current index. Direct text and regex reads issue character-range citations with a SHA-256 of the exact selection, and the range viewer verifies offsets before highlighting. Missing/deleted sources and changed text are rejected. Unmappable transformed evidence is never given an invented source range. Deleting a base invalidates its old citations.

Reference behavior came from the user's archived Local AI version 2 evidence-links module and source panel. Validation now includes streaming split tests, source provenance/origin checks, malformed references, code literals, saved-block equivalence, range HTTP checks, and a real local-model answer against the rebuilt PDF library. The local-model test produced two Soyuz claims whose links opened their supporting passages.
