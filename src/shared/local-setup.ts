export interface SearchPreferences {
  ocrModel: string
  descriptionModel: string
  device: 'auto' | 'cpu' | 'npu' | 'igpu' | 'gpu'
  threads: number
  unloadSeconds: number
  quietSeconds: number
  schedule: 'always' | 'background' | 'window' | 'paused'
  windowStart: string
  windowEnd: string
}

export interface LocalSetup {
  setup: {
    status: 'new' | 'running' | 'ready' | 'error'
    step: number
    device: string
    error?: string
    progress?: { received: number; total: number }
  }
  steps: string[]
  settings: SearchPreferences
}

export interface VisionCatalog {
  models: Array<{ id: string; name: string; verified: boolean; acceptsImages?: boolean }>
  unavailable: string[]
}

export interface DocumentSetup {
  status: 'new' | 'running' | 'ready' | 'error'
  supported: boolean
  stage?: string
  progress?: { received: number; total: number }
  error?: string
  backend?: 'ovis' | 'ovis-bf16'
}
