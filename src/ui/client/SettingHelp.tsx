import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { C } from './theme.js'

/** Portaled so the settings panel's scrolling container cannot clip the explanation. */
export function SettingHelp(props: { label: string; text: string }): JSX.Element {
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>()
  const [position, setPosition] = useState<{ top: number; left: number; above: boolean } | null>(null)
  useEffect(() => () => clearTimeout(hideTimer.current), [])
  useEffect(() => {
    if (!position) return
    const close = () => setPosition(null)
    window.addEventListener('resize', close)
    return () => window.removeEventListener('resize', close)
  }, [position])
  const show = () => {
    clearTimeout(hideTimer.current)
    const rect = button.current?.getBoundingClientRect()
    if (!rect) return
    const above = rect.bottom > window.innerHeight / 2
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 444)), top: above ? rect.top - 8 : rect.bottom + 8, above })
  }
  const hide = () => { hideTimer.current = setTimeout(() => setPosition(null), 150) }
  return <span style={{ display: 'inline-flex', marginLeft: 7, verticalAlign: 'middle' }} onMouseEnter={show} onMouseLeave={hide}>
    <button type="button" ref={button} aria-label={`About ${props.label}`} aria-describedby={position ? id : undefined}
      onFocus={show} onBlur={hide} onClick={show} onKeyDown={event => { if (event.key === 'Escape') { clearTimeout(hideTimer.current); setPosition(null) } }}
      style={{ border: `1px solid ${C.border}`, borderRadius: '50%', width: 18, height: 18, padding: 0, lineHeight: '16px', fontSize: 12, fontWeight: 600, background: C.surface2, color: C.muted, cursor: 'help' }}>i</button>
    {position && createPortal(<div id={id} role="tooltip" onMouseEnter={() => clearTimeout(hideTimer.current)} onMouseLeave={hide}
      style={{ position: 'fixed', zIndex: 10000, left: position.left, top: position.top, transform: position.above ? 'translateY(-100%)' : undefined,
        width: 420, maxWidth: 'calc(100vw - 24px)', maxHeight: Math.max(60, (position.above ? position.top : window.innerHeight - position.top) - 12), overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: `${C.border} transparent`, boxSizing: 'border-box', padding: '14px 16px', borderRadius: 10,
        border: `1px solid ${C.border}`, background: C.surface, color: C.text, boxShadow: '0 8px 28px #0006', fontSize: 13, fontWeight: 400, lineHeight: 1.6 }}>
      <strong>{props.label}</strong>
      {props.text.split('\n\n').map((paragraph, index) => <p key={index} style={{ margin: '8px 0 0' }}>{paragraph}</p>)}
    </div>, document.body)}
  </span>
}
