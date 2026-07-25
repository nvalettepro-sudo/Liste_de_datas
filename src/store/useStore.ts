import { create } from 'zustand'
import { DEFAULT_REL_TYPES } from '../lib/types'
import { layoutGraph, type XY } from '../lib/graphLayout'
import type {
  EntityTypeSummary,
  AggregatedEntityData,
  GlobalSearchResult,
  GraphNode,
  GraphEdge,
  GraphRelType,
  WorkerOutMessage,
} from '../lib/types'

export type { XY }

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

  /* --- Vue graphe (v2) --- */
  graphOpen: boolean
  graphLoading: boolean
  graphRootId: string | null
  graphNodes: GraphNode[]
  graphEdges: GraphEdge[]
  graphPositions: Record<string, XY>
  graphExpanded: string[]
  graphRelTypes: GraphRelType[]
  graphEntityFilter: string[] | null
  graphStoreyFilter: string | null
  graphTruncated: boolean
  graphOmitted: number

  loadFile: (file: File) => void
  selectType: (type: string) => void
  setSearchQuery: (q: string) => void
  triggerGlobalSearch: () => void
  clearGlobalSearch: () => void
  clearError: () => void

  openGraph: (entityType: string) => void
  closeGraph: () => void
  expandGraphNode: (nodeId: string) => void
  setGraphNodePosition: (nodeId: string, pos: XY) => void
  relayoutGraph: () => void
  toggleGraphRelType: (relType: GraphRelType) => void
  setGraphEntityFilter: (types: string[] | null) => void
  setGraphStoreyFilter: (nodeId: string | null) => void
}

let worker: Worker | null = null

type SetState = (
  s: Partial<AppState> | ((prev: AppState) => Partial<AppState>)
) => void

function getOrCreateWorker(set: SetState) {
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
    } else if (msg.type === 'graphData') {
      const { originId, nodes, edges, truncated, omittedCount } = msg.payload
      const isRoot = originId.startsWith('g:root:')

      set((prev) => {
        const baseNodes = isRoot ? [] : prev.graphNodes
        const baseEdges = isRoot ? [] : prev.graphEdges

        const byId = new Map(baseNodes.map((n) => [n.id, n]))
        for (const n of nodes) byId.set(n.id, n)

        const edgeById = new Map(baseEdges.map((e) => [e.id, e]))
        for (const e of edges) edgeById.set(e.id, e)

        const allNodes = Array.from(byId.values())
        const allEdges = Array.from(edgeById.values())

        return {
          graphNodes: allNodes,
          graphEdges: allEdges,
          // Recalcul complet : une expansion locale (anneau) désynchronise
          // vite l'ensemble dès que plusieurs zones sont étendues séparément.
          graphPositions: layoutGraph(allNodes, allEdges),
          graphExpanded: isRoot
            ? [originId]
            : prev.graphExpanded.includes(originId)
              ? prev.graphExpanded
              : [...prev.graphExpanded, originId],
          graphRootId: isRoot ? originId : prev.graphRootId,
          graphLoading: false,
          graphTruncated: truncated,
          graphOmitted: omittedCount,
          isLoading: false,
          loadPhase: '',
        }
      })
    } else if (msg.type === 'error') {
      set({ error: msg.message, isLoading: false, isSearching: false, graphLoading: false })
    }
  }
  worker.onerror = (e) => {
    set({ error: e.message, isLoading: false, graphLoading: false })
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

  graphOpen: false,
  graphLoading: false,
  graphRootId: null,
  graphNodes: [],
  graphEdges: [],
  graphPositions: {},
  graphExpanded: [],
  graphRelTypes: DEFAULT_REL_TYPES,
  graphEntityFilter: null,
  graphStoreyFilter: null,
  graphTruncated: false,
  graphOmitted: 0,

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
      globalSearchResults: null,
      graphOpen: false,
      graphNodes: [],
      graphEdges: [],
      graphPositions: {},
      graphExpanded: [],
      graphRootId: null,
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

  openGraph: (entityType: string) => {
    if (!worker) return
    set({
      graphOpen: true,
      graphLoading: true,
      graphNodes: [],
      graphEdges: [],
      graphPositions: {},
      graphExpanded: [],
      graphRootId: null,
      graphEntityFilter: null,
      graphStoreyFilter: null,
      graphTruncated: false,
      graphOmitted: 0,
    })
    worker.postMessage({ type: 'graphOpenType', entityType, relTypes: get().graphRelTypes })
  },

  closeGraph: () => set({ graphOpen: false }),

  expandGraphNode: (nodeId: string) => {
    if (!worker) return
    if (get().graphExpanded.includes(nodeId)) return
    set({ graphLoading: true })
    worker.postMessage({ type: 'graphExpand', nodeId, relTypes: get().graphRelTypes })
  },

  setGraphNodePosition: (nodeId: string, pos: XY) => {
    set((prev) => ({ graphPositions: { ...prev.graphPositions, [nodeId]: pos } }))
  },

  relayoutGraph: () => {
    const { graphNodes, graphEdges } = get()
    set({ graphPositions: layoutGraph(graphNodes, graphEdges) })
  },

  /**
   * Changer les relations traversées invalide le graphe courant : on le
   * reconstruit depuis la racine plutôt que de laisser des arêtes obsolètes.
   */
  toggleGraphRelType: (relType: GraphRelType) => {
    const cur = get().graphRelTypes
    const next = cur.includes(relType)
      ? cur.filter((t) => t !== relType)
      : [...cur, relType]
    set({ graphRelTypes: next })

    const rootId = get().graphRootId
    if (!rootId || !worker || next.length === 0) return
    const entityType = rootId.replace('g:root:', '')
    set({
      graphLoading: true,
      graphNodes: [],
      graphEdges: [],
      graphPositions: {},
      graphExpanded: [],
    })
    worker.postMessage({ type: 'graphOpenType', entityType, relTypes: next })
  },

  setGraphEntityFilter: (types: string[] | null) => set({ graphEntityFilter: types }),

  setGraphStoreyFilter: (nodeId: string | null) => set({ graphStoreyFilter: nodeId }),
}))
