/**
 * Cherry Studio-style Local Models settings section: model cards with
 * download / retry / remove actions and a live progress bar, mirroring
 * `LocalModelsSection` + `ModelCard`. The settings shell supplies only the
 * `close` owner prop; data and actions arrive through the inject face.
 * @module dsh-knowledge/client/LocalModelsSection
 */
import { KnowledgeApi } from './api.js';
import type { Translate } from './locales.js';
import type { DirectoryActions } from './directory-actions.js';
export interface LocalModelsSectionProps {
    close: () => void;
    api: KnowledgeApi;
    t: Translate;
    /** Verified native/host capabilities; picker and opener are independent. */
    directoryActions?: DirectoryActions;
}
export declare function LocalModelsSection(props: LocalModelsSectionProps): JSX.Element;
//# sourceMappingURL=LocalModelsSection.d.ts.map