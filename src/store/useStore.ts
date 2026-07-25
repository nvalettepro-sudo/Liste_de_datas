import { create } from 'zustand'
import { DEFAULT_REL_TYPES } from '../lib/types'
import type {
  EntityTypeSummary,
  AggregatedEntityData,
  GlobalSearchResult,
  GraphNode,
  GraphEdge,
  GraphRelType,
  WorkerOutMessage,
} from '../lib/types'

export interface XY { x: number; y: number }

/** Rayon d'expansion autour du nœud parent, en pixels. */
const RING_RADIUS = 340

/**
 * Dispose les nouveaux nœuds sur un anneau autour de leur origine. Le rayon
 * croît par paliers quand l'anneau est saturé, pour limiter les recouvrements
 * sans recourir à un moteur de layout complet (les nœuds restent déplaçables).
 */
function layoutAround(origin: XY, ids: string[], existing: Record<string, XY>): Record<string, XY> {
  const out: Record<string, XY> = {}
  const perRing = 10
  ids.forEach((id, i) => {
    const ring = Math.floor(i / perRing)
    const idxInRing = i % perRing
    const inThisRing = Math.min(perRing, ids.length - ring * perRing)
    const radius = RING_RADIUS * (1 + ring * 0.55)
    const angle = (idxInRing / inThisRing) * Math.PI * 2 + ring * 0.4
    let pos = { x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius }
    // Décalage si la position est déjà occupée par un nœud existant.
    let guard = 0
    while (
      guard < 12 &&
      Object.values(existing).some((p) => Math.abs(p.x - pos.x) < 120 && Math.abs(p.y - pos.y) < 70)
    ) {
      pos = { x: pos.x + 70, y: pos.y + 45 }
      guard++
    }
    out[id] = pos
    existing[id] = pos
  })
  return out
}

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
        const positions: Record<string, XY> = isRoot ? {} : { ...prev.graphPositions }

        const byId = new Map(baseNodes.map((n) => [n.id, n]))
        const freshIds: string[] = []
        for (const n of nodes) {
          if (!byId.has(n.id)) freshIds.push(n.id)
          byId.set(n.id, n)
        }

        if (isRoot) {
          positions[originId] = { x: 0, y: 0 }
        }
        const originPos = positions[originId] ?? { x: 0, y: 0 }
        const placeable = freshIds.filter((id) => id !== originId)
        Object.assign(positions, layoutAround(originPos, placeable, positions))

        const edgeById = new Map(baseEdges.map((e) => [e.id, e]))
        for (const e of edges) edgeById.set(e.id, e)

        return {
          graphNodes: Array.from(byId.values()),
          graphEdges: Array.from(edgeById.values()),
          graphPositions: positions,
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
