import { create } from 'zustand'
import type {
  EntityTypeSummary,
  AggregatedEntityData,
  GlobalSearchResult,
  WorkerOutMessage,
} from '../lib/types'

interface AppState {
  fileName: string | null
  ifcVersion: string | null
  isLoading: boolean
  loadProgress: number
  loadPhase: string
  error: string | null
  entityTypes: EntityTypeSummary[]
  selectedType: string | null
  aggregatedData: AggregatedEntityData | null
  searchQuery: string
  globalSearchResults: GlobalSearchResult[] | null
  isSearching: boolean

  loadFile: (file: File) => void
  selectType: (type: string) => void
  setSearchQuery: (q: string) => void
  triggerGlobalSearch: () => void
  clearGlobalSearch: () => void
  clearError: () => void
}

let worker: Worker | null = null

function getOrCreateWorker(set: (s: Partial<AppState>) => void) {
  if (worker) {
    worker.terminate()
    worker = null
  }
  worker = new Worker(new URL('../workers/ifc.worker.ts', import.meta.url), {
    type: 'module',
  })
  worker.postMessage({ type: 'init', wasmPath: import.meta.env.BASE_URL })
  worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
    const msg = e.data
    if (msg.type === 'progress') {
      set({ loadProgress: msg.percent, loadPhase: msg.phase, isLoading: true })
    } else if (msg.type === 'ready') {
      set({
        entityTypes: msg.entityTypes,
        ifcVersion: msg.ifcVersion,
        isLoading: false,
        loadProgress: 100,
        loadPhase: '',
        selectedType: null,
        aggregatedData: null,
      })
    } else if (msg.type === 'aggregated') {
      set({
        aggregatedData: msg.data,
        isLoading: false,
        loadProgress: 100,
        loadPhase: '',
      })
    } else if (msg.type === 'searchResults') {
      set({ globalSearchResults: msg.results, isSearching: false })
    } else if (msg.type === 'error') {
      set({ error: msg.message, isLoading: false, isSearching: false })
    }
  }
  worker.onerror = (e) => {
    set({ error: e.message, isLoading: false })
  }
  return worker
}

export const useStore = create<AppState>((set, get) => ({
  fileName: null,
  ifcVersion: null,
  isLoading: false,
  loadProgress: 0,
  loadPhase: '',
  error: null,
  entityTypes: [],
  selectedType: null,
  aggregatedData: null,
  searchQuery: '',
  globalSearchResults: null,
  isSearching: false,

  loadFile: (file: File) => {
    set({
      fileName: file.name,
      isLoading: true,
      loadProgress: 0,
      loadPhase: 'Lecture du fichier…',
      error: null,
      entityTypes: [],
      aggregatedData: null,
      selectedType: null,
    })
    const w = getOrCreateWorker(set)
    file.arrayBuffer().then((buf) => {
      w.postMessage({ type: 'load', buffer: buf }, [buf])
    })
  },

  selectType: (type: string) => {
    if (!worker) return
    set({
      selectedType: type,
      isLoading: true,
      loadProgress: 0,
      loadPhase: `Agrégation des ${type}…`,
      aggregatedData: null,
    })
    worker.postMessage({ type: 'select', entityType: type })
  },

  setSearchQuery: (q: string) => {
    set({ searchQuery: q })
  },

  triggerGlobalSearch: () => {
    const { searchQuery } = get()
    const q = searchQuery.trim()
    if (!q || !worker) return
    set({ isSearching: true, globalSearchResults: null })
    worker.postMessage({ type: 'search', query: q })
  },

  clearGlobalSearch: () => {
    set({ globalSearchResults: null, isSearching: false })
  },

  clearError: () => set({ error: null }),
}))
