/**
 * Shared theme tokens (DSH tokens with Cherry-Studio-like fallbacks) and the
 * panel's inline style vocabulary, used by the panel and every dialog.
 * @module dsh-knowledge/client/theme
 */
import type { CSSProperties } from 'react';
export declare const C: {
    readonly bg: "var(--dsw-alias-bg-base, #f6f7f9)";
    readonly surface: "var(--dsw-alias-bg-layer-1, #ffffff)";
    readonly surface2: "var(--dsw-alias-bg-layer-2, #f1f2f5)";
    readonly overlay: "var(--dsw-alias-bg-overlay, #ffffff)";
    readonly text: "var(--dsw-alias-label-primary, #1f2329)";
    readonly muted: "color-mix(in srgb, var(--dsw-alias-label-primary, #1f2329) 72%, transparent)";
    readonly border: "var(--dsw-alias-border-l2, #c7ccd4)";
    readonly borderStrong: "var(--dsw-alias-border-l3, #9aa1ab)";
    readonly accent: "var(--dsw-alias-brand-primary, #3b6ef6)";
    readonly danger: "var(--dsw-alias-state-error-primary, #e5484d)";
    readonly success: "var(--dsw-alias-state-success-primary, #30a46c)";
    readonly warn: "var(--dsw-alias-state-warn-primary, #f5a623)";
};
export declare const accentSoft = "color-mix(in srgb, var(--dsw-alias-brand-primary, #3b6ef6) 10%, transparent)";
/** One-off hover/animation CSS injected once by the panel. */
export declare const PANEL_CSS = "\n@keyframes kb-spin { to { transform: rotate(360deg) } }\n@keyframes kb-fade-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }\n.kb-spinner { animation: kb-spin 0.9s linear infinite }\n.kb-panel-in { animation: kb-fade-in 0.18s ease-out }\n/* Theme-adaptive interaction fills. DSH's own layer tokens are pure white in\n   the light theme and its interactive-bg-hover is only ~6% alpha, so hovers\n   built on them are nearly invisible. Derive hover/active fills from the\n   inverted label-primary token instead: ~9% black-on-white in light, ~9%\n   white-on-dark in dark \u2014 clearly visible in both base themes. Declared on\n   body (portal menus and the sidebar action render outside the panel) and\n   re-scoped to the panel root. */\nbody, .kb-panel-in {\n  --kb-hover: color-mix(in srgb, var(--dsw-alias-label-primary, #1f2329) 9%, transparent);\n  --kb-active: color-mix(in srgb, var(--dsw-alias-label-primary, #1f2329) 16%, transparent);\n}\n.kb-row { transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease }\n.kb-row:hover { background: var(--kb-hover) }\n/* Menu items fill on hover/active; the fill rides a CSS variable referenced from\n   the inline background so the class can override the inline style. */\n.kb-menuitem { transition: background 0.15s ease }\n.kb-menuitem:hover { --kb-mibg: var(--kb-hover) }\n.kb-menuitem:active { --kb-mibg: var(--kb-active) }\n.kb-card { transition: border-color 0.15s ease, background 0.15s ease }\n.kb-card:hover { border-color: var(--dsw-alias-border-l2, #c7ccd4) }\n.kb-iconbtn { transition: color 0.15s ease, background 0.15s ease }\n.kb-iconbtn:hover { color: var(--dsw-alias-brand-primary, #3b6ef6); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #3b6ef6) 10%, transparent) }\n/* Buttons styled with style.button get a hover tint like the shell's own\n   buttons. The tint rides a CSS variable referenced from the inline\n   background, because inline styles outrank plain class rules: on hover the\n   variable flips and the inline background follows it. The .kb-panel-in rule\n   covers every panel button even without the kb-btn class (the class is only\n   required for the settings section, which lives outside the panel). */\n.kb-btn { transition: background 0.15s ease, border-color 0.15s ease }\n.kb-btn:hover { --kb-btn-bg: var(--kb-hover) }\n.kb-btn:disabled:hover { --kb-btn-bg: var(--dsw-alias-bg-layer-1, #ffffff) }\n.kb-panel-in button:hover { --kb-btn-bg: var(--kb-hover) }\n.kb-panel-in button:disabled:hover { --kb-btn-bg: var(--dsw-alias-bg-layer-1, #ffffff) }\n/* Backgrounds live in classes (not inline) so :hover can override them, the\n   same way the shell's Settings trigger styles itself. */\n.kb-sidebar-action { background: transparent }\n.kb-sidebar-action:hover { background: var(--kb-hover) }\n.kb-sidebar-action:active { background: var(--kb-active) }\n.kb-dangerbtn:hover { color: var(--dsw-alias-state-error-primary, #e5484d); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 10%, transparent) }\n/* Primary (accent-filled) buttons: DSH's brand-primary inverts between themes\n   (near-black in light, near-white in dark) and ships a dedicated hover token,\n   so the hover fill follows that token and stays visible in both. */\n.kb-primary { transition: background 0.15s ease, filter 0.15s ease }\n.kb-primary:hover:not(:disabled) { --kb-primary-bg: var(--dsw-alias-button-primary-hover, #43454a) }\n.kb-primary:active:not(:disabled) { filter: brightness(0.94) }\n.kb-primary:disabled { opacity: 0.5; cursor: not-allowed }\n.kb-danger-primary { transition: background 0.15s ease, filter 0.15s ease }\n.kb-danger-primary:hover:not(:disabled) { --kb-danger-bg: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 78%, #000) }\n.kb-danger-primary:active:not(:disabled) { filter: brightness(0.94) }\n.kb-danger-primary:disabled { opacity: 0.5; cursor: not-allowed }\n/* Disabled feedback for every panel button. */\n.kb-panel-in button:disabled { opacity: 0.5; cursor: not-allowed }\n/* Visible focus indicators (DSH's business-primary is a blue that reads in\n   both themes, unlike the inverted brand-primary). */\n.kb-panel-in button:focus-visible, .kb-menuitem:focus-visible, .kb-sidebar-action:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 2px }\n.kb-panel-in input:focus, .kb-panel-in select:focus, .kb-panel-in textarea:focus { box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 35%, transparent) }\n/* Resize sash: an 8px grab strip whose 2px grip lights up on hover so the\n   draggable edge is discoverable (a 5px transparent sliver was impossible to\n   find/click). z-index keeps it above adjacent scrollbars. */\n.kb-sash { position: relative; z-index: 6 }\n.kb-sash::before { content: ''; position: absolute; top: 0; bottom: 0; left: 50%; transform: translateX(-50%); width: 2px; background: transparent; transition: background 0.15s ease }\n.kb-sash:hover::before { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #3b6ef6) 45%, transparent) }\n.kb-scroll::-webkit-scrollbar { width: 8px; height: 8px }\n.kb-scroll::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l2, #c7ccd4); border-radius: 999px }\n.kb-scroll::-webkit-scrollbar-track { background: transparent }\n.kb-rag-config { container-type: inline-size }\n.kb-rag-config-field { display: grid; grid-template-columns: minmax(0, 1fr) minmax(160px, 42%); align-items: center; gap: 12px 20px; margin-bottom: 18px }\n.kb-rag-config-control { min-width: 0 }\n@container (max-width: 640px) {\n  .kb-rag-config-field { grid-template-columns: minmax(0, 1fr); align-items: start; gap: 8px; margin-bottom: 20px }\n  .kb-rag-config-control { width: 100% }\n  .kb-rag-config-control:has([role=\"switch\"]) { width: auto; justify-self: start }\n}\n";
export declare const style: {
    readonly panel: CSSProperties;
    readonly header: CSSProperties;
    readonly headerLeft: CSSProperties;
    readonly headerTitle: CSSProperties;
    readonly headerActions: CSSProperties;
    readonly iconButton: CSSProperties;
    readonly closeButton: CSSProperties;
    readonly body: CSSProperties;
    readonly sidebar: CSSProperties;
    readonly newBaseButton: CSSProperties;
    readonly baseCard: CSSProperties;
    readonly baseCardActive: CSSProperties;
    readonly baseAvatar: CSSProperties;
    readonly baseName: CSSProperties;
    readonly baseMeta: CSSProperties;
    readonly baseSourceRow: CSSProperties;
    readonly baseSourceItem: CSSProperties;
    readonly baseSourceGlyph: CSSProperties;
    readonly baseSourceText: CSSProperties;
    readonly baseSourceEdit: CSSProperties;
    readonly main: CSSProperties;
    readonly card: CSSProperties;
    readonly cardTitle: CSSProperties;
    readonly button: CSSProperties;
    readonly primary: CSSProperties;
    readonly primaryDanger: CSSProperties;
    readonly danger: CSSProperties;
    readonly input: CSSProperties;
    readonly textarea: CSSProperties;
    readonly dropzone: CSSProperties;
    readonly dropzoneActive: CSSProperties;
    readonly actionsRow: CSSProperties;
    readonly statsRow: CSSProperties;
    readonly statChip: CSSProperties;
    readonly statValue: CSSProperties;
    readonly statLabel: CSSProperties;
    readonly docRow: CSSProperties;
    readonly docIcon: CSSProperties;
    readonly docTitle: CSSProperties;
    readonly docMeta: CSSProperties;
    readonly docActions: CSSProperties;
    readonly chunk: CSSProperties;
    readonly hit: CSSProperties;
    readonly scorePill: CSSProperties;
    readonly mark: CSSProperties;
    readonly label: CSSProperties;
    readonly field: CSSProperties;
    readonly hint: CSSProperties;
    readonly empty: CSSProperties;
    readonly error: CSSProperties;
    readonly modalBackdrop: CSSProperties;
    readonly modal: CSSProperties;
    readonly modalHeader: CSSProperties;
    readonly sidebarAction: CSSProperties;
    readonly sidebarActionRail: CSSProperties;
    readonly sidebarActionActive: CSSProperties;
    readonly tabs: CSSProperties;
    readonly tab: CSSProperties;
    readonly tabActive: CSSProperties;
    readonly toastStack: CSSProperties;
    readonly toast: CSSProperties;
    readonly toastClose: CSSProperties;
    readonly fileRow: CSSProperties;
    readonly spinner: CSSProperties;
    readonly menu: CSSProperties;
    readonly menuItem: CSSProperties;
    readonly menuItemDanger: CSSProperties;
    readonly menuSeparator: CSSProperties;
    readonly sectionTitle: CSSProperties;
    readonly sectionHint: CSSProperties;
    readonly sliderRow: CSSProperties;
    readonly sliderValue: CSSProperties;
    readonly sliderBounds: CSSProperties;
    readonly switch: CSSProperties;
    readonly switchOn: CSSProperties;
    readonly switchKnob: CSSProperties;
    readonly accordionHeader: CSSProperties;
    readonly warningHint: CSSProperties;
    readonly ghostButton: CSSProperties;
    readonly iconOnlyButton: CSSProperties;
    readonly tableHeadRow: CSSProperties;
    readonly tableRow: CSSProperties;
    readonly checkbox: CSSProperties;
    readonly checkboxOn: CSSProperties;
    readonly sidePanelScrim: CSSProperties;
    readonly sidePanel: CSSProperties;
    readonly sidePanelHeader: CSSProperties;
    readonly sidePanelBody: CSSProperties;
};
/** Palette for auto-colored base avatars (hash → color). */
export declare const AVATAR_COLORS: readonly ["#3b6ef6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#ef4444", "#6366f1"];
export declare function avatarColor(name: string): string;
/** Human-readable size from a character count (≈ bytes). */
export declare function formatSize(charCount: number): string;
/**
 * Compact relative time, locale-aware via the bound translate (the old
 * implementation hardcoded Chinese “刚刚 / N 分钟前…” which leaked into the
 * English UI). now is only overridable for tests.
 */
export declare function formatRelativeTime(timestamp: number, t?: (key: 'timeJustNow' | 'timeMinutes' | 'timeHours' | 'timeDays') => string, now?: number): string;
//# sourceMappingURL=theme.d.ts.map