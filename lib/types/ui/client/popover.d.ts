/**
 * Minimal popover menu (Cherry Studio's row "⋯" / toolbar menus). A click
 * toggle with outside-click dismissal; entries may be separators, danger
 * items, or submenus (hover or click to open).
 * @module dsh-knowledge/client/popover
 */
import type { ReactNode } from 'react';
export interface MenuEntry {
    key: string;
    /** Omit the label to render a separator. */
    label?: string;
    icon?: JSX.Element;
    danger?: boolean;
    onSelect?: () => void;
    children?: readonly MenuEntry[];
}
export declare function PopoverMenu(props: {
    trigger: ReactNode;
    entries: readonly MenuEntry[];
    align?: 'start' | 'end';
}): JSX.Element;
/** Fixed-position context menu (right-click), sharing the same entry shape. */
export declare function ContextMenu(props: {
    x: number;
    y: number;
    entries: readonly MenuEntry[];
    onClose: () => void;
}): JSX.Element;
//# sourceMappingURL=popover.d.ts.map