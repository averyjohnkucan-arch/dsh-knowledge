/**
 * Cherry Studio-style knowledge base UI: a sidebar-foot nav action plus a
 * frame-wide floating panel. Left navigator holds search + base cards; the
 * detail side has Cherry Studio's three views — 资料 (data source list),
 * 召回测试 (recall test), and 设置 (per-base rag config with 文档处理 /
 * 嵌入模型 / 重排模型 / Top K / 高级设置) — switched by the detail header.
 * Row actions ride a hover-revealed "⋯" menu; feedback rides toasts.
 * @module dsh-knowledge/client/KnowledgeSection
 */
import { type LocalModelsSectionProps } from './LocalModelsSection.js';
import { KnowledgeApi } from './api.js';
import type { Translate } from './locales.js';
import type { KnowledgePanelStore } from './panel-store.js';
export type { Translate } from './locales.js';
/** The sidebar-foot entry beside Settings: opens the knowledge panel.
 *  Styled to match the shell's Settings trigger (same 34px row / 36px rail
 *  geometry and tokens) so the footer reads as one unit. */
export declare function SidebarKnowledgeAction(props: {
    store: KnowledgePanelStore;
    t: Translate;
    wide: boolean;
}): JSX.Element;
export declare function KnowledgeSettings(props: LocalModelsSectionProps): JSX.Element | null;
/** Frame-wide Cherry Studio-style knowledge base page. */
export declare function KnowledgePanel(props: {
    store: KnowledgePanelStore;
    api: KnowledgeApi;
    t: Translate;
}): JSX.Element | null;
//# sourceMappingURL=KnowledgeSection.d.ts.map