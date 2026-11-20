/**
 * Open/close state for the knowledge panel, shared between the sidebar-foot
 * action and the frame-wide overlay. A tiny external store consumed through
 * React's useSyncExternalStore.
 * @module dsh-knowledge/client/panel-store
 */
export interface KnowledgePanelStore {
    getSnapshot(): boolean;
    subscribe(listener: () => void): () => void;
    open(): void;
    close(): void;
    toggle(): void;
}
export declare function createKnowledgePanelStore(): KnowledgePanelStore;
//# sourceMappingURL=panel-store.d.ts.map