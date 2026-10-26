/** Pure viewport placement helpers shared by the portal popover and tests. */
export interface ViewportSize {
    width: number;
    height: number;
}
export interface BoxSize {
    width: number;
    height: number;
}
export interface RectEdges {
    top: number;
    right: number;
    bottom: number;
    left: number;
}
export interface ViewportPosition {
    top: number;
    left: number;
}
/** Place a root menu below/above its trigger and clamp both axes. */
export declare function placePopover(trigger: RectEdges, menu: BoxSize, viewport: ViewportSize, align?: 'start' | 'end'): ViewportPosition;
/** Place a submenu beside its parent row, flipping left near the right edge. */
export declare function placeSubmenu(parent: RectEdges, menu: BoxSize, viewport: ViewportSize): ViewportPosition;
//# sourceMappingURL=popover-placement.d.ts.map