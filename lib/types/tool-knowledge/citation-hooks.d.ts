import type { Events } from '@deepseek-ai/cordis';
type RequestMessage = Parameters<Events['llm/stream']>[0]['messages'][number];
type StreamChunk = ReturnType<Events['llm/stream']> extends AsyncIterable<infer T> ? T : never;
/** Content-addressed handles: no session-global counter or mutable source registry. */
export declare function citationHandle(url: string): string;
export declare function citationDefinition(url: string): string;
/** Only our injected messages and results of knowledge tools can introduce handles. */
export declare function requestCitations(messages: readonly RequestMessage[], origin: string): Map<string, string>;
/** A bounded incremental decoder. Partial hooks never flash into the live answer. */
export declare class CitationDecoder {
    private resolve;
    private pending;
    private code;
    private lineStart;
    private escaped;
    constructor(resolve: (id: string) => string | undefined);
    push(text: string, final?: boolean): string;
}
/** Transform visible text only; tool arguments, reasoning and usage stay untouched. */
export declare function resolveCitationStream(stream: AsyncIterable<StreamChunk>, resolve: (id: string) => string | undefined): AsyncIterable<StreamChunk>;
export declare function resolvedCitation(label: string, path: string, origin: string): string;
export {};
//# sourceMappingURL=citation-hooks.d.ts.map