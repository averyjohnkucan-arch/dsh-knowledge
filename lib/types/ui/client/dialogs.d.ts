/**
 * Dialog system for the knowledge panel: modal shell, create/edit-base,
 * confirm, single-prompt (rename), and the Cherry Studio-style add-document
 * dialog with 文本/文件/网页 tabs, multi-file upload and drag-drop.
 * @module dsh-knowledge/client/dialogs
 */
import type { ReactNode } from 'react';
import type { SearchMode } from './api.js';
import type { Translate } from './locales.js';
export interface Toast {
    id: number;
    kind: 'success' | 'error' | 'info' | 'warning';
    text: string;
}
export declare function Toasts(props: {
    toasts: readonly Toast[];
    onDismiss?: (id: number) => void;
}): JSX.Element | null;
export declare function Modal(props: {
    title: string;
    onClose: () => void;
    children: ReactNode;
    width?: number;
}): JSX.Element;
export declare function ConfirmDialog(props: {
    title: string;
    message: string;
    confirmLabel: string;
    /** Optional impact lines, rendered as a list under the message (used by the
     *  cascading-delete confirmation to name the exact scope being removed). */
    details?: readonly string[];
    busy?: boolean;
    onConfirm: () => void;
    onClose: () => void;
}): JSX.Element;
export declare function PromptDialog(props: {
    title: string;
    label: string;
    initial: string;
    /** The parent's in-flight flag. When it falls back to false the action has
     *  settled, so the submit latch below is released: parents keep this dialog
     *  mounted on FAILURE (they only close it on success), and without this the OK
     *  button stayed disabled forever after one failed rename/create, forcing the
     *  user to close the dialog and retype everything. */
    busy?: boolean;
    onOk: (value: string) => void;
    onClose: () => void;
}): JSX.Element;
/** Cherry's note-create: a title + content text document added straight to the base. */
export declare function TextDocumentDialog(props: {
    t: Translate;
    busy?: boolean;
    onCreate: (title: string, content: string) => void;
    onClose: () => void;
}): JSX.Element;
/** Embedding configuration chosen for the rebuilt base (undefined = keep the source base's config). */
export interface RestoreEmbeddingConfig {
    provider: 'openai' | 'ollama' | 'local';
    baseUrl: string;
    model: string;
    apiKey: string;
}
export declare function RestoreBaseDialog(props: {
    defaultName: string;
    t: Translate;
    busy?: boolean;
    onRestore: (name: string, config?: RestoreEmbeddingConfig) => void;
    onClose: () => void;
}): JSX.Element;
export declare function CreateBaseDialog(props: {
    t: Translate;
    groups: readonly string[];
    initialGroup?: string;
    busy?: boolean;
    onCreate: (name: string, description: string, group: string | undefined, external: {
        storageMode: 'internal' | 'external';
        externalPath?: string;
        syncIntervalSeconds?: number;
    }) => void;
    onPickFolder: () => Promise<{
        path: string | null;
    }>;
    onClose: () => void;
}): JSX.Element;
declare const FILE_ACCEPT = ".txt,.md,.markdown,.mdx,.csv,.html,.htm,.json,.log,.pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.epub";
declare const MAX_FILES = 20;
/**
 * Upload cap: the JSON upload API limits bodies to 32MB, so a base64 payload
 * leaves ~24MB for the file itself. Pre-checked client-side with headroom
 * (22MB) so oversized files fail with a clear message, not a server 500.
 */
declare const MAX_UPLOAD_BYTES: number;
export { FILE_ACCEPT, MAX_FILES, MAX_UPLOAD_BYTES };
/** Extension set shared by the directory import filter (Cherry's directory scan skips others). */
export declare const SUPPORTED_IMPORT_EXTENSIONS: Set<string>;
export declare function readFileAsBase64(file: File): Promise<string>;
/** Re-exported for type consumers of the client dictionary surface. */
export type { SearchMode };
//# sourceMappingURL=dialogs.d.ts.map