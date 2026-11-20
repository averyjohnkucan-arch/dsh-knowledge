import type { KnowledgeApi } from './api.js';
import type { Translate } from './locales.js';
/** Optional local MinerU deployment flow; detection never installs software. */
export declare function MineruDeploymentSection({ api, t, pickDirectory }: {
    api: KnowledgeApi;
    t: Translate;
    pickDirectory?: () => Promise<string | null>;
}): JSX.Element;
//# sourceMappingURL=MineruDeploymentSection.d.ts.map