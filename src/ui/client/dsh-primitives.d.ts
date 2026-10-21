/** Public browser exports are supplied by the DSH shell's frozen module table. */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
 import type { ComponentType, ReactNode } from 'react'
 export const DisclosureRow: ComponentType<{icon:ReactNode;title:string;titleClassName?:string;open:boolean;expandable:boolean;expandOnRowClick?:boolean;keepContentWhenOpen?:boolean;onToggle:()=>void;collapsedContent?:ReactNode;children?:ReactNode}>
 export const IconBrowseOutlineRegular: ComponentType<{size?:number}>
}
