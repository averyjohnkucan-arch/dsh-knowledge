import { KnowledgeApi } from './api.js';
import type { BaseSummary, KnowledgeConfig } from './api.js';
import type { Translate } from './locales.js';
interface PanelProps {
    base: BaseSummary;
    globalConfig: KnowledgeConfig;
    api: KnowledgeApi;
    t: Translate;
    busy: boolean;
    onSaved: () => void;
}
export declare function RagConfigPanel(props: PanelProps): JSX.Element;
export {};
//# sourceMappingURL=rag-config.d.ts.map