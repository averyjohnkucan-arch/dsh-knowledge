/** Linear traversal; visiting each file must not rescan a 50,000-document library. */
export declare function documentSubtreeIds(documents: readonly {
    id: string;
    parentDirectoryId?: string;
}[], rootId: string): string[];
//# sourceMappingURL=document-tree.d.ts.map