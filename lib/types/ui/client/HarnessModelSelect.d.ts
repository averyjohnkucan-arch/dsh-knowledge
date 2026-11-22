import type { VisionCatalog } from '../../shared/local-setup.js';
import type { KnowledgeApi } from './api.js';
import { type Translate } from './locales.js';
export declare function useHarnessModels(api: KnowledgeApi, enabled?: boolean): VisionCatalog | undefined;
interface Props {
    catalog?: VisionCatalog;
    label: string;
    empty: string;
    value: string;
    onChange: (id: string) => void;
    disabled?: boolean;
    t?: Translate;
}
export declare function HarnessModelSelect({ catalog, label, empty, value, onChange, disabled, t }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=HarnessModelSelect.d.ts.map