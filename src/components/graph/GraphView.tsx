import { useCallback, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useStore } from '../../store/useStore'
import { REL_META } from '../../lib/graphMeta'
import { IFC_FR } from '../../lib/ifcTranslations'
import { GraphNodeCard, type GraphNodeCardData } from './GraphNodeCard'
import { GraphFilters } from './GraphFilters'

const nodeTypes = { ifcNode: GraphNodeCard }

const MINIMAP_COLORS: Record<string, string> = {
  definition: '#a78bfa',
  spatial: '#fbbf24',
  occurrence: '#38bdf8',
  group: '#34d399',
}

export function GraphView() {
  const graphNodes = useStore((s) => s.graphNodes)
  const graphEdges = useStore((s) => s.graphEdges)
  const graphPositions = useStore((s) => s.graphPositions)
  const graphRootId = useStore((s) => s.graphRootId)
  const graphExpanded = useStore((s) => s.graphExpanded)
  const graphLoading = useStore((s) => s.graphLoading)
  const graphTruncated = useStore((s) => s.graphTruncated)
  const graphOmitted = useStore((s) => s.graphOmitted)
  const graphEntityFilter = useStore((s) => s.graphEntityFilter)
  const graphStoreyFilter = useStore((s) => s.graphStoreyFilter)
  const closeGraph = useStore((s) => s.closeGraph)
  const expandGraphNode = useStore((s) => s.expandGraphNode)
  const setGraphNodePosition = useStore((s) => s.setGraphNodePosition)

  /**
   * Filtrage client : le filtre spatial ne garde que les nœuds directement
   * reliés à l'étage choisi dans le graphe courant (la racine reste toujours
   * visible pour ne jamais perdre le point d'entrée).
   */
  const visibleNodeIds = useMemo(() => {
    let ids = new Set(graphNodes.map((n) => n.id))

    if (graphEntityFilter) {
      const allowed = new Set(graphEntityFilter)
      ids = new Set(
        graphNodes.filter((n) => n.id === graphRootId || allowed.has(n.entityType)).map((n) => n.id)
      )
    }

    if (graphStoreyFilter) {
      const adjacent = new Set<string>([graphStoreyFilter])
      if (graphRootId) adjacent.add(graphRootId)
      for (const e of graphEdges) {
        if (e.source === graphStoreyFilter) adjacent.add(e.target)
        if (e.target === graphStoreyFilter) adjacent.add(e.source)
      }
      ids = new Set(Array.from(ids).filter((id) => adjacent.has(id)))
    }

    return ids
  }, [graphNodes, graphEdges, graphEntityFilter, graphStoreyFilter, graphRootId])

  const rfNodes: Node[] = useMemo(
    () =>
      graphNodes
        .filter((n) => visibleNodeIds.has(n.id))
        .map((n) => ({
          id: n.id,
          type: 'ifcNode',
          position: graphPositions[n.id] ?? { x: 0, y: 0 },
          data: {
            node: n,
            isRoot: n.id === graphRootId,
            isExpanded: graphExpanded.includes(n.id),
          } satisfies GraphNodeCardData,
        })),
    [graphNodes, graphPositions, graphRootId, graphExpanded, visibleNodeIds]
  )

  const rfEdges: Edge[] = useMemo(
    () =>
      graphEdges
        .filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
        .map((e) => {
          const meta = REL_META[e.relType]
          return {
            id: e.id,
            source: e.source,
            target: e.target,
            label: e.count > 1 ? `×${e.count}` : undefined,
            labelStyle: { fill: '#9ca3af', fontSize: 10 },
            labelBgStyle: { fill: '#111827' },
            style: { stroke: meta.color, strokeWidth: Math.min(1 + Math.log10(e.count + 1) * 1.6, 4) },
            markerEnd: { type: MarkerType.ArrowClosed, color: meta.color, width: 16, height: 16 },
            data: { relType: e.relType },
          }
        }),
    [graphEdges, visibleNodeIds]
  )

  const onNodeDoubleClick: NodeMouseHandler = useCallback(
    (_evt, node) => expandGraphNode(node.id),
    [expandGraphNode]
  )

  const onNodeDragStop: OnNodeDrag = useCallback(
    (_evt, node) => setGraphNodePosition(node.id, node.position),
    [setGraphNodePosition]
  )

  const rootType = graphRootId?.replace('g:root:', '') ?? ''
  const rootFr = IFC_FR[rootType]

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-gray-950">
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-b border-gray-800 bg-gray-900">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-100 leading-tight">
            Graphe de relations {rootFr ? `— ${rootFr}` : ''}
          </p>
          <p className="text-[11px] font-mono text-gray-500">{rootType}</p>
        </div>

        <div className="flex-1" />

        {graphLoading && <span className="text-xs text-blue-400 animate-pulse">Calcul…</span>}

        <span className="text-[11px] text-gray-500">
          {rfNodes.length} nœud{rfNodes.length > 1 ? 's' : ''} · {rfEdges.length} arête
          {rfEdges.length > 1 ? 's' : ''}
        </span>

        <button
          onClick={closeGraph}
          className="px-2 py-1 text-xs text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-gray-200 transition-colors"
        >
          ✕ Fermer
        </button>
      </div>

      {graphTruncated && (
        <div className="flex-shrink-0 px-4 py-1.5 bg-amber-950/60 border-b border-amber-800/60">
          <p className="text-[11px] text-amber-300">
            Affichage limité : {graphOmitted} voisin{graphOmitted > 1 ? 's' : ''} masqué
            {graphOmitted > 1 ? 's' : ''}. Affinez les filtres pour tout explorer.
          </p>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <GraphFilters />

        <div className="flex-1 min-w-0 relative">
          {rfNodes.length === 0 && !graphLoading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-gray-600 text-sm italic px-8 text-center">
                Aucune relation à afficher avec les filtres actuels.
              </p>
            </div>
          ) : (
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              onNodeDoubleClick={onNodeDoubleClick}
              onNodeDragStop={onNodeDragStop}
              fitView
              minZoom={0.1}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#1f2937" gap={20} />
              <Controls className="!bg-gray-900 !border-gray-700" />
              <MiniMap
                pannable
                zoomable
                bgColor="#0b1220"
                maskColor="rgba(3,7,18,0.75)"
                style={{ width: 150, height: 100 }}
                className="!border !border-gray-800"
                nodeColor={(n) => MINIMAP_COLORS[(n.data as GraphNodeCardData).node.kind] ?? '#6b7280'}
                nodeStrokeWidth={3}
              />
            </ReactFlow>
          )}
        </div>
      </div>
    </div>
  )
}
