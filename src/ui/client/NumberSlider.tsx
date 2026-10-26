import { useEffect, useState } from 'react'
import { C, style } from './theme.js'

export interface NumberSliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  disabled?: boolean
}
export function normalizeSliderValue(raw: string, min: number, max: number, step: number): number | undefined {
  if (raw.trim() === '') return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) return undefined
  const bounded = Math.max(min, Math.min(max, value))
  const rounded = min + Math.round((bounded - min) / step) * step
  return Math.max(min, Math.min(max, Number(rounded.toFixed(6))))
}
/** Draft text stays editable; only valid, bounded numbers reach saved settings. */
export function NumberSlider(props: NumberSliderProps): JSX.Element {
  const [draft, setDraft] = useState(String(props.value))
  useEffect(() => setDraft(String(props.value)), [props.value])
  const commit = () => {
    const next = normalizeSliderValue(draft, props.min, props.max, props.step) ?? props.value
    setDraft(String(next))
    if (next !== props.value) props.onChange(next)
  }
  return <div style={{ width: '100%', minWidth: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <input type="range" aria-label={props.label} min={props.min} max={props.max} step={props.step}
        disabled={props.disabled} value={props.value}
        onChange={event => { const next = Number(event.target.value); setDraft(String(next)); props.onChange(next) }}
        style={{ flex: 1, width: 0, minWidth: 40, accentColor: C.accent }} />
      <input type="number" aria-label={`${props.label} value`} min={props.min} max={props.max} step={props.step}
        disabled={props.disabled} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit() } if (event.key === 'Escape') setDraft(String(props.value)) }}
        style={{ ...style.input, width: 94, fontVariantNumeric: 'tabular-nums' }} />
    </div>
    <div style={{ ...style.sliderBounds, paddingRight: 106 }}><span>{props.min}</span><span>{props.max}</span></div>
  </div>
}
