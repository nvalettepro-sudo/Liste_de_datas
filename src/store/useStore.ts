import { create } from 'zustand'
import { DEFAULT_REL_TYPES, GRAPH_REL_TYPES } from '../lib/types'
import { layoutGraph, type XY } from '../lib/graphLayout'
import { buildHubGraph, type HubGraphNode, type HubGraphEdge } from '../lib/hubGraph'
import { layoutHubGraph, computeHomeHubs } from '../lib/hubLayout'
import type {
  EntityTypeSummary,
  AggregatedEntityData,
  GlobalSearchResult,
  GraphNode,
  GraphEdge,
  GraphRelType,
  TypeGraphNode,
  TypeGraphEdge,
  WorkerOutMessage,
} from '../lib/types'

export type { XY }

/**
 * Reconstruit le graphe à hubs et son layout à partir du graphe brut,
 * restreint aux relations actuellement actives. Recalculer plutôt que
 * filtrer visuellement garantit qu'un type affiché appartient toujours à un
 * hub lui-même affiché — sinon une carte peut se retrouver rattachée (pour
 * le regroupement) à un hub masqué, et apparaître sans en-tête ni possibilité
 * de déplacement groupé.
 */
function recomputeOverview(
  rawNodes: TypeGraphNode[],
  rawEdges: TypeGraphEdge[],
  relTypes: GraphRelType[]
): { nodes: HubGraphNode[]; edges: HubGraphEdge[]; positions: Record<string, XY> } {
  const filteredEdges = rawEdges.filter((e) => relTypes.includes(e.relType))
  const { nodes, edges } = buildHubGraph(rawNodes, filteredEdges)
  const positions = layoutHubGraph(nodes, edges, GRAPH_REL_TYPES)
  return { nodes, edges, positions }
}

/**
 * La vue d'ensemble a des nœuds à très haut degré (ex. IfcPropertySet relié à
 * la plupart des types) — un espacement plus large que le mode détail limite
 * les croisements d'arêtes qui la rendent illisible.
 */

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
  /** 'overview' = maquette entière (maille type) ; 'detail' = exploration instance. */
  graphView: 'overview' | 'detail'
  /** Vrai si le mode détail a été atteint par drill-down depuis la vue d'ensemble. */
  graphCameFromOverview: boolean
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

  /* --- Vue d'ensemble (v2.1) — graphe à hubs de relation --- */
  /** Graphe type-à-type brut, avant transformation en hubs — sert à recalculer
   * le regroupement quand les relations actives changent. */
  overviewRawNodes: TypeGraphNode[]
  overviewRawEdges: TypeGraphEdge[]
  overviewNodes: HubGraphNode[]
  overviewEdges: HubGraphEdge[]
  overviewPositions: Record<string, XY>
  /** Positions calculées par le layout, jamais modifiées par le glisser — sert de référence pour "Recaler". */
  overviewComputedPositions: Record<string, XY>
  overviewRelTypes: GraphRelType[]

  loadFile: (file: File) => void
  closeFile: () => void
  selectType: (type: string) => void
  setSearchQuery: (q: string) => void
  triggerGlobalSearch: () => void
  clearGlobalSearch: () => void
  clearError: () => void

  openGraph: (entityType: string, fromOverview?: boolean) => void
  closeGraph: () => void
  expandGraphNode: (nodeId: string) => void
  setGraphNodePosition: (nodeId: string, pos: XY) => void
  relayoutGraph: () => void
  toggleGraphRelType: (relType: GraphRelType) => void
  setGraphEntityFilter: (types: string[] | null) => void
  setGraphStoreyFilter: (nodeId: string | null) => void

  openGraphOverview: () => void
  toggleOverviewRelType: (relType: GraphRelType) => void
  setOverviewNodePosition: (nodeId: string, pos: XY) => void
  moveOverviewGroup: (hubId: string, memberIds: string[], dx: number, dy: number) => void
  relayoutOverview: () => void
  resetOverviewNodePosition: (nodeId: string) => void
}

let worker: Worker | null = null

type SetState = (
  s: Partial<AppState> | ((prev: AppState) => Partial<AppState>)
) => void
type GetState = () => AppState

function getOrCreateWorker(set: SetState, get: GetState) {
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
    } else if (msg.type === 'graphOverviewData') {
      // Le graphe brut (type à type) est conservé pour pouvoir recalculer le
      // regroupement à chaque changement de relations actives (voir
      // recomputeOverview) — sinon un type peut rester rattaché à un hub
      // masqué et s'afficher sans en-tête.
      const relTypes = get().overviewRelTypes
      const { nodes: hubNodes, edges: hubEdges, positions } = recomputeOverview(
        msg.payload.nodes,
        msg.payload.edges,
        relTypes
      )
      set({
        overviewRawNodes: msg.payload.nodes,
        overviewRawEdges: msg.payload.edges,
        overviewNodes: hubNodes,
        overviewEdges: hubEdges,
        overviewPositions: positions,
        overviewComputedPositions: positions,
        graphLoading: false,
        isLoading: false,
        loadPhase: '',
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
  graphView: 'overview',
  graphCameFromOverview: false,
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

  overviewRawNodes: [],
  overviewRawEdges: [],
  overviewNodes: [],
  overviewEdges: [],
  overviewPositions: {},
  overviewComputedPositions: {},
  // IfcRelDefinesByProperties reste décoché par défaut : sur une vraie
  // maquette, la quasi-totalité des types portent des Psets, ce qui en fait
  // un hub connecté à presque tout le graphe — un vrai nid d'oiseau à
  // l'affichage, même si le coût de calcul reste négligeable à cette maille.
  overviewRelTypes: [...DEFAULT_REL_TYPES],

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
      overviewRawNodes: [],
      overviewRawEdges: [],
      overviewNodes: [],
      overviewEdges: [],
      overviewPositions: {},
      overviewComputedPositions: {},
    })
    const w = getOrCreateWorker(set, get)
    file.arrayBuffer().then((buf) => {
      w.postMessage({ type: 'load', buffer: buf }, [buf])
    })
  },

  closeFile: () => {
    if (worker) {
      worker.terminate()
      worker = null
    }
    set({
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
      graphEntityFilter: null,
      graphStoreyFilter: null,
      graphTruncated: false,
      graphOmitted: 0,
      overviewRawNodes: [],
      overviewRawEdges: [],
      overviewNodes: [],
      overviewEdges: [],
      overviewPositions: {},
      overviewComputedPositions: {},
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

  openGraph: (entityType: string, fromOverview = false) => {
    if (!worker) return
    set({
      graphOpen: true,
      graphView: 'detail',
      graphCameFromOverview: fromOverview,
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

  closeGraph: () => {
    // Revenir à la vue d'ensemble plutôt que tout fermer si on y est arrivé
    // par drill-down : elle est déjà calculée, pas besoin de la refaire.
    if (get().graphCameFromOverview) {
      set({ graphView: 'overview', graphCameFromOverview: false })
    } else {
      set({ graphOpen: false })
    }
  },

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

  openGraphOverview: () => {
    if (!worker) return
    set({
      graphOpen: true,
      graphView: 'overview',
      graphCameFromOverview: false,
      graphLoading: true,
    })
    worker.postMessage({ type: 'graphOverview' })
  },

  /**
   * Recalcule le regroupement à chaque changement de relations actives :
   * un simple filtrage d'affichage laisserait des types rattachés à un hub
   * masqué, sans en-tête ni possibilité de déplacement groupé.
   */
  toggleOverviewRelType: (relType: GraphRelType) => {
    const { overviewRelTypes, overviewRawNodes, overviewRawEdges } = get()
    const next = overviewRelTypes.includes(relType)
      ? overviewRelTypes.filter((t) => t !== relType)
      : [...overviewRelTypes, relType]
    const { nodes, edges, positions } = recomputeOverview(overviewRawNodes, overviewRawEdges, next)
    set({
      overviewRelTypes: next,
      overviewNodes: nodes,
      overviewEdges: edges,
      overviewPositions: positions,
      overviewComputedPositions: positions,
    })
  },

  setOverviewNodePosition: (nodeId: string, pos: XY) => {
    set((prev) => ({ overviewPositions: { ...prev.overviewPositions, [nodeId]: pos } }))
  },

  /** Ramène un nœud déplacé à la position calculée par le layout (sous son en-tête). */
  /**
   * Recale un type sous son en-tête, où que celui-ci se trouve désormais —
   * pas à sa position calculée d'origine, qui ne correspond plus à rien si
   * le hub lui-même a été déplacé depuis. On rejoue donc l'écart relatif
   * d'origine (position calculée du type moins celle du hub) à partir de la
   * position actuelle du hub.
   */
  resetOverviewNodePosition: (nodeId: string) => {
    set((prev) => {
      const computedNode = prev.overviewComputedPositions[nodeId]
      if (!computedNode) return {}

      const hubId = computeHomeHubs(prev.overviewNodes, prev.overviewEdges).get(nodeId)
      const computedHub = hubId ? prev.overviewComputedPositions[hubId] : undefined
      const currentHub = hubId ? prev.overviewPositions[hubId] : undefined

      const target =
        computedHub && currentHub
          ? {
              x: currentHub.x + (computedNode.x - computedHub.x),
              y: currentHub.y + (computedNode.y - computedHub.y),
            }
          : computedNode

      return { overviewPositions: { ...prev.overviewPositions, [nodeId]: target } }
    })
  },

  /**
   * Déplace un hub et tous les types qui lui sont rattachés (mêmes membres
   * que le couloir calculé par layoutHubGraph) d'un même décalage, en un
   * seul rendu — le hub sert de "poignée" pour déplacer tout son groupe.
   */
  moveOverviewGroup: (hubId: string, memberIds: string[], dx: number, dy: number) => {
    set((prev) => {
      const positions = { ...prev.overviewPositions }
      const hubPos = positions[hubId]
      if (hubPos) positions[hubId] = { x: hubPos.x + dx, y: hubPos.y + dy }
      for (const id of memberIds) {
        const p = positions[id]
        if (p) positions[id] = { x: p.x + dx, y: p.y + dy }
      }
      return { overviewPositions: positions }
    })
  },

  relayoutOverview: () => {
    const { overviewNodes, overviewEdges } = get()
    const positions = layoutHubGraph(overviewNodes, overviewEdges, GRAPH_REL_TYPES)
    set({ overviewPositions: positions, overviewComputedPositions: positions })
  },
}))
