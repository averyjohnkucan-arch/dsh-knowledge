import React from 'react';
/** Only producer-owned user/message events are claimed; ordinary chat stays with DSH. */
interface RetrievalEvent {
    type: string;
    seq: number;
    surfaceOp?: unknown;
    data: {
        id?: string;
        source?: {
            kind?: string;
            passageCount?: number;
        };
        content?: readonly {
            type: string;
            text?: string;
        }[];
        surface?: unknown;
    };
}
interface Match {
    event: RetrievalEvent;
    location: unknown;
}
interface ProjectionContext {
    key: string;
    id: string;
    start?: Match;
    state?: ReturnType<typeof retrievalRecord>;
}
export declare function retrievalRecord(event: RetrievalEvent): {
    text: string;
    count: number;
};
export declare const retrievalDefinition: {
    kind: string;
    target: string;
    match: {
        'user/message': (event: RetrievalEvent) => {
            id: string;
            role: "start";
            exclusive: true;
        } | null;
    };
    start: (_context: unknown, match: Match) => {
        text: string;
        count: number;
    };
    update: (context: ProjectionContext) => {
        text: string;
        count: number;
    } | undefined;
    buildViewNode: (context: ProjectionContext) => {
        key: string;
        id: string;
        kind: string;
        target: string;
        anchorSeq: number;
        location: unknown;
        visibility: string;
        data: {
            text: string;
            count: number;
        };
    } | null;
};
/** Source frames are producer formatting, not user-facing prose. Never render their HTML. */
export declare function parseRetrievalPassages(text: string): {
    title: string;
    heading: string;
    base: string;
    documentId: string;
    chunkId: string;
    excerpt: string;
}[];
export declare function KnowledgeRetrieval({ node, useDisclosure }: {
    node: {
        data: ReturnType<typeof retrievalRecord>;
    };
    useDisclosure: () => {
        expanded: boolean;
        toggle: () => void;
    };
}): React.JSX.Element;
export {};
//# sourceMappingURL=KnowledgeRetrieval.d.ts.map