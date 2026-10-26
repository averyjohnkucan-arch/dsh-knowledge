/**
 * Inline SVG icons for the knowledge panel (no icon dependency). A file-type
 * helper picks the icon and brand color by extension, Cherry Studio style.
 * @module dsh-knowledge/client/icons
 */
import type { CSSProperties } from 'react';
interface IconProps {
    size?: number;
    color?: string;
}
export declare function IconBook(props: IconProps): JSX.Element;
export declare function IconDoc(props: IconProps): JSX.Element;
export declare function IconPdf(props: IconProps): JSX.Element;
export declare function IconWord(props: IconProps): JSX.Element;
export declare function IconMarkdown(props: IconProps): JSX.Element;
export declare function IconText(props: IconProps): JSX.Element;
export declare function IconGlobe(props: IconProps): JSX.Element;
export declare function IconPlus(props: IconProps): JSX.Element;
export declare function IconUpload(props: IconProps): JSX.Element;
export declare function IconLink(props: IconProps): JSX.Element;
export declare function IconGear(props: IconProps): JSX.Element;
export declare function IconSearch(props: IconProps): JSX.Element;
export declare function IconPencil(props: IconProps): JSX.Element;
export declare function IconTrash(props: IconProps): JSX.Element;
export declare function IconCheck(props: IconProps): JSX.Element;
export declare function IconX(props: IconProps): JSX.Element;
export declare function IconRefresh(props: IconProps): JSX.Element;
export declare function IconFlask(props: IconProps): JSX.Element;
export declare function IconSliders(props: IconProps): JSX.Element;
export declare function IconMore(props: IconProps): JSX.Element;
export declare function IconEye(props: IconProps): JSX.Element;
export declare function IconDownload(props: IconProps): JSX.Element;
export declare function IconBox(props: IconProps): JSX.Element;
/** File-type icon and color by extension, Cherry Studio style. */
export declare function fileVisual(name: string): {
    color: string;
    icon: (props: IconProps) => JSX.Element;
};
/** Document-row icon style wrapper. */
export declare function docIconStyle(color: string): CSSProperties;
export declare function IconFolder(props: IconProps): JSX.Element;
export declare function IconFolderInput(props: IconProps): JSX.Element;
export declare function IconFolderOpen(props: IconProps): JSX.Element;
export declare function IconFolderSearch(props: IconProps): JSX.Element;
export declare function IconScanText(props: IconProps): JSX.Element;
export declare function IconBot(props: IconProps): JSX.Element;
export {};
//# sourceMappingURL=icons.d.ts.map