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
/** Frame-wide Cherry Studio-style knowledge base page. */
export declare function KnowledgePanel(props: {
    store: KnowledgePanelStore;
    api: KnowledgeApi;
    t: Translate;
}): JSX.Element | null;
//# sourceMappingURL=KnowledgeSection.d.ts.map