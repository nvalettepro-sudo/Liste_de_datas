import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  type Node,
  type Edge,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type OnNodeDrag,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useStore } from '../../store/useStore'
import { GRAPH_REL_TYPES, type GraphRelType } from '../../lib/types'
import { REL_META } from '../../lib/graphMeta'
import { computeHomeHubs } from '../../lib/hubLayout'
import { TypeNodeCard, type TypeNodeCardData } from './TypeNodeCard'
import { HubNodeCard, type HubNodeCardData } from './HubNodeCard'

const nodeTypes = { typeNode: TypeNodeCard, hubNode: HubNodeCard }

interface SelectedEdgeInfo {
  sourceLabel: string
  targetLabel: string
  relType: GraphRelType
  count: number
}

export function GraphOverview() {
  const overviewNodes = useStore((s) => s.overviewNodes)
  const overviewEdges = useStore((s) => s.overviewEdges)
  const overviewPositions = useStore((s) => s.overviewPositions)
  const overviewRelTypes = useStore((s) => s.overviewRelTypes)
  const graphLoading = useStore((s) => s.graphLoading)
  const closeGraph = useStore((s) => s.closeGraph)
  const openGraph = useStore((s) => s.openGraph)
  const toggleOverviewRelType = useStore((s) => s.toggleOverviewRelType)
  const setOverviewNodePosition = useStore((s) => s.setOverviewNodePosition)
  const moveOverviewGroup = useStore((s) => s.moveOverviewGroup)
  const relayoutOverview = useStore((s) => s.relayoutOverview)
  const rfInstance = useRef<ReactFlowInstance | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<SelectedEdgeInfo | null>(null)

  const labelById = useMemo(() => {
    const m = new Map<string, string>()
    for (const n of overviewNodes) m.set(n.id, n.label)
    return m
  }, [overviewNodes])

  /**
   * Membres de chaque groupe (mêmes rattachements que le layout en couloirs) :
   * déplacer un hub déplace avec lui les types qui lui sont rattachés.
   */
  const groupMembers = useMemo(() => {
    const home = computeHomeHubs(overviewNodes, overviewEdges)
    const byHub = new Map<string, string[]>()
    for (const [typeId, hubId] of home.entries()) {
      if (!byHub.has(hubId)) byHub.set(hubId, [])
      byHub.get(hubId)!.push(typeId)
    }
    return byHub
  }, [overviewNodes, overviewEdges])

  const visibleEdges = useMemo(
    () => overviewEdges.filter((e) => overviewRelTypes.includes(e.relType)),
    [overviewEdges, overviewRelTypes]
  )

  const visibleNodeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const e of visibleEdges) {
      ids.add(e.source)
      ids.add(e.target)
    }
    return ids
  }, [visibleEdges])

  const rfNodes: Node[] = useMemo(
    () =>
      overviewNodes
        .filter((n) => visibleNodeIds.has(n.id))
        .map((n) =>
          n.kind === 'hub'
            ? {
                id: n.id,
                type: 'hubNode',
                position: overviewPositions[n.id] ?? { x: 0, y: 0 },
                data: { relType: n.relType!, count: n.count } satisfies HubNodeCardData,
              }
            : {
                id: n.id,
                type: 'typeNode',
                position: overviewPositions[n.id] ?? { x: 0, y: 0 },
                data: {
                  node: { id: n.id, entityType: n.entityType!, count: n.count },
                } satisfies TypeNodeCardData,
              }
        ),
    [overviewNodes, overviewPositions, visibleNodeIds]
  )

  /**
   * Le nom de chaque relation est déjà écrit sur son hub — plus besoin
   * d'étiquette permanente sur chaque arête. Le détail (type source, type
   * cible, nombre d'occurrences) reste disponible au clic, dans le bandeau.
   */
  const rfEdges: Edge[] = useMemo(
    () =>
      visibleEdges.map((e) => {
        const meta = REL_META[e.relType]
        const isSelected =
          selectedEdge?.relType === e.relType &&
          selectedEdge?.sourceLabel === labelById.get(e.source) &&
          selectedEdge?.targetLabel === labelById.get(e.target)
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          style: {
            stroke: meta.color,
            strokeWidth: isSelected ? 4 : Math.min(1 + Math.log10(e.count + 1) * 0.9, 3),
            opacity: isSelected ? 1 : 0.6,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: meta.color, width: 14, height: 14 },
          data: { relType: e.relType, count: e.count },
        }
      }),
    [visibleEdges, selectedEdge, labelById]
  )

  const onNodeDoubleClick: NodeMouseHandler = useCallback(
    (_evt, node) => {
      if (node.id.startsWith('hub:')) return
      openGraph(node.id, true)
    },
    [openGraph]
  )

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_evt, edge) => {
      const data = edge.data as { relType: GraphRelType; count: number } | undefined
      if (!data) return
      setSelectedEdge({
        sourceLabel: labelById.get(edge.source) ?? edge.source,
        targetLabel: labelById.get(edge.target) ?? edge.target,
        relType: data.relType,
        count: data.count,
      })
    },
    [labelById]
  )

  const onPaneClick = useCallback(() => setSelectedEdge(null), [])

  /**
   * Le hub sert de poignée pour son groupe : le déplacer entraîne avec lui
   * tous les types qui lui sont rattachés, comme un seul bloc. Le delta est
   * calculé à chaque frame par rapport à la dernière position connue du hub
   * (lue directement dans le store pour rester exacte pendant le drag).
   */
  const onNodeDrag: OnNodeDrag = useCallback(
    (_evt, node) => {
      if (!node.id.startsWith('hub:')) return
      const members = groupMembers.get(node.id)
      if (!members || members.length === 0) return
      const prevPos = useStore.getState().overviewPositions[node.id]
      if (!prevPos) return
      const dx = node.position.x - prevPos.x
      const dy = node.position.y - prevPos.y
      if (dx === 0 && dy === 0) return
      moveOverviewGroup(node.id, members, dx, dy)
    },
    [groupMembers, moveOverviewGroup]
  )

  const onNodeDragStop: OnNodeDrag = useCallback(
    (_evt, node) => setOverviewNodePosition(node.id, node.position),
    [setOverviewNodePosition]
  )

  const centerView = useCallback(() => {
    rfInstance.current?.fitView({ padding: 0.2, duration: 300 })
  }, [])

  const handleRelayout = useCallback(() => {
    relayoutOverview()
    requestAnimationFrame(() => centerView())
  }, [relayoutOverview, centerView])

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-gray-950">
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-b border-gray-800 bg-gray-900">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-100 leading-tight">
            Vue d'ensemble de la maquette
          </p>
          <p className="text-[11px] text-gray-500">Relations IFC réelles, par hub nommé</p>
        </div>

        <div className="flex-1" />

        {selectedEdge && (
          <span className="text-xs text-gray-200 bg-gray-800 border border-gray-700 rounded px-2 py-1">
            <span className="font-mono">{selectedEdge.sourceLabel}</span>
            {' → '}
            <span className="font-mono">{selectedEdge.targetLabel}</span>
            {' · '}
            <span style={{ color: REL_META[selectedEdge.relType].color }}>
              {REL_META[selectedEdge.relType].label}
            </span>
            <span className="text-gray-600 font-mono"> ({selectedEdge.relType})</span>
            {' × '}
            {selectedEdge.count.toLocaleString('fr-FR')}
          </span>
        )}

        {graphLoading && <span className="text-xs text-blue-400 animate-pulse">Calcul…</span>}

        <span className="text-[11px] text-gray-500">
          {rfNodes.length} nœud{rfNodes.length > 1 ? 's' : ''} · {rfEdges.length} lien
          {rfEdges.length > 1 ? 's' : ''}
        </span>

        <button
          onClick={centerView}
          className="px-2 py-1 text-xs text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-gray-200 transition-colors"
          title="Recentrer le graphe dans la fenêtre"
        >
          ⊙ Centrer
        </button>

        <button
          onClick={handleRelayout}
          className="px-2 py-1 text-xs text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-gray-200 transition-colors"
          title="Recalculer une disposition claire du graphe"
        >
          ⟲ Réorganiser
        </button>

        <button
          onClick={() => closeGraph()}
          className="px-2 py-1 text-xs text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-gray-200 transition-colors"
        >
          ✕ Fermer
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-56 flex-shrink-0 border-r border-gray-800 bg-gray-900 overflow-y-auto px-3 py-3">
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Relations affichées
          </h3>
          <div className="space-y-1.5">
            {GRAPH_REL_TYPES.map((rel) => {
              const meta = REL_META[rel]
              const checked = overviewRelTypes.includes(rel)
              return (
                <label key={rel} className="flex items-start gap-2 cursor-pointer group" title={meta.hint}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleOverviewRelType(rel)}
                    className="mt-0.5 accent-blue-600 flex-shrink-0"
                  />
                  <span className="min-w-0">
                    <span
                      className="block text-xs text-gray-300 group-hover:text-gray-100"
                      style={{ color: checked ? meta.color : undefined }}
                    >
                      {meta.label}
                    </span>
                    <span className="block text-[10px] font-mono text-gray-600 truncate">{rel}</span>
                  </span>
                </label>
              )
            })}
          </div>

          <p className="mt-4 text-[10px] text-gray-600 leading-snug">
            Chaque relation IFC apparaît comme un nœud nommé. Double-clic sur
            un type pour explorer ses instances en détail.
          </p>
        </div>

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
              onInit={(instance) => { rfInstance.current = instance }}
              onNodeDoubleClick={onNodeDoubleClick}
              onNodeDrag={onNodeDrag}
              onNodeDragStop={onNodeDragStop}
              onEdgeClick={onEdgeClick}
              onPaneClick={onPaneClick}
              fitView
              minZoom={0.05}
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
                nodeColor={(n) => (n.type === 'hubNode' ? '#f5f5f5' : '#38bdf8')}
                nodeStrokeWidth={3}
              />
            </ReactFlow>
          )}
        </div>
      </div>
    </div>
  )
}
