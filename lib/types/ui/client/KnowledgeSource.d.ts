import React from 'react';
import type { Context } from '@deepseek-ai/cordis';
interface Navigation {
    revision: number;
    params?: {
        href?: string;
        title?: string;
    };
}
interface SourceProps {
    useTabInfo: () => {
        tab: {
            navigation: Navigation;
        };
    };
}
export declare const SOURCE_CSS = "@keyframes kb-cite-pulse{0%,45%{background:#f5cb5588}100%{background:#f5cb5528}}\n.kb-cited{animation:kb-cite-pulse 1.8s ease-out;background:#f5cb5528;border-left:3px solid #ce9b13}\n.kb-source-line{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.7 monospace;padding:2px 6px}\n.kb-line-number{display:inline-block;min-width:3.5em;opacity:.6;user-select:none}\na[href*=\"/knowledge/documents/\"][href*=\"#citation\"]:not([data-knowledge-source-external]){display:inline-block;vertical-align:baseline;max-width:100%;padding:.08em .45em;margin:0 .18em;border:1px solid #8884;border-radius:.4em;background:#8882;color:inherit;font-size:.78em;line-height:1.5;overflow-wrap:anywhere;text-decoration:none}\na[href*=\"/knowledge/documents/\"][href*=\"#citation\"]:not([data-knowledge-source-external]):hover{text-decoration:underline}\na[href*=\"/knowledge/documents/\"][href*=\"/raw?inline=1\"]{display:inline-block;vertical-align:baseline;padding:.08em .45em;margin:0 .18em;border:1px solid #8884;border-radius:.4em;background:#8882;font-size:.78em;line-height:1.5;color:#3b82f6;text-decoration:underline;text-underline-offset:2px}\na[href*=\"/knowledge/documents/\"][href*=\"/raw?inline=1\"] svg,a[href*=\"/knowledge/documents/\"][href*=\"#citation\"] svg{display:none}\na[href*=\"/knowledge/documents/\"][href*=\"#citation\"]:has(+ a[href*=\"/raw?inline=1\"]){border-radius:.4em 0 0 .4em;border-right:0;margin-right:0;max-width:calc(100% - 7em);box-sizing:border-box;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom}\na[href*=\"/knowledge/documents/\"][href*=\"#citation\"] + a[href*=\"/raw?inline=1\"]{border-radius:0 .4em .4em 0;border-left:0;margin-left:0;white-space:nowrap;vertical-align:bottom}\n@media(prefers-reduced-motion:reduce){.kb-cited{animation:none}}";
/** Uses the tab's persisted navigation, so sessions and repeated clicks stay independent. */
export declare function KnowledgeSource({ useTabInfo }: SourceProps): React.JSX.Element;
export declare function installKnowledgeSource(ctx: Context): void;
export {};
//# sourceMappingURL=KnowledgeSource.d.ts.map