/**
 * Cherry Studio-style per-base retrieval settings panel (the 设置 view): the
 * exact section order of RagConfigPanel — 文档处理, 嵌入模型, 重排模型,
 * Top K + 相似度阈值, and a collapsed 高级设置 accordion — with a
 * 重置 / 保存 footer and dirty tracking.
 * @module dsh-knowledge/client/rag-config
 */
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