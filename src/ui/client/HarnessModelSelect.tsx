import { useEffect, useState } from 'react'
import type { VisionCatalog } from '../../shared/local-setup.js'
import type { KnowledgeApi } from './api.js'
import { en, type Translate } from './locales.js'
import { style } from './theme.js'

export function useHarnessModels(api: KnowledgeApi, enabled = true): VisionCatalog | undefined {
  const [catalog, setCatalog] = useState<VisionCatalog>()
  useEffect(() => {
    if (!enabled) return
    let live = true
    setCatalog(undefined)
    void api.setupVisionModels().then(result => { if (live) setCatalog(result) })
      .catch(() => { if (live) setCatalog({ models: [], unavailable: ['Harness'] }) })
    return () => { live = false }
  }, [api, enabled])
  return catalog
}

interface Props {
  catalog?: VisionCatalog
  label: string
  empty: string
  value: string
  onChange: (id: string) => void
  disabled?: boolean
  t?: Translate
}

export function HarnessModelSelect({ catalog, label, empty, value, onChange, disabled, t = key => en[key] }: Props) {
  const listed = catalog?.models.some(model => model.id === value)
  return <>
    <select aria-label={label} style={style.input} value={value} disabled={disabled}
      onChange={event => onChange(event.target.value)}>
      <option value="">{empty}</option>
      {value && !listed && <option value={value}>{value}{catalog ? ' · ' + t('harnessModelUnlisted') : ''}</option>}
      {catalog?.models.map(model => <option key={model.id} value={model.id} disabled={model.acceptsImages === false}>
        {model.name}{model.acceptsImages === false ? ' · ' + t('harnessModelNoImages') : !model.verified ? ' · ' + t('harnessModelUnknownImages') : ''}
      </option>)}
    </select>
    {!catalog && <small role="status" style={style.hint}>{t('harnessModelsLoading')}</small>}
    {catalog?.models.length === 0 && !catalog.unavailable.length && <small style={style.hint}>{t('harnessModelsEmpty')}</small>}
    {catalog && catalog.unavailable.length > 0 && <small role="status" style={style.hint}>{t('harnessModelsUnavailable').replace('{providers}', catalog.unavailable.join(', '))}</small>}
  </>
}
