import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { IFC_FR } from '../../lib/ifcTranslations'
import type { GraphNode } from '../../lib/types'

/** Palette par catégorie de nœud — cohérente avec la légende du panneau de filtres. */
export const KIND_STYLES: Record<GraphNode['kind'], { box: string; dot: string; label: string }> = {
  definition: {
    box: 'border-violet-600 bg-violet-950/70',
    dot: 'bg-violet-400',
    label: 'Définition (partagée)',
  },
  spatial: {
    box: 'border-amber-600 bg-amber-950/70',
    dot: 'bg-amber-400',
    label: 'Structure spatiale',
  },
  occurrence: {
    box: 'border-sky-700 bg-sky-950/70',
    dot: 'bg-sky-400',
    label: 'Occurrence',
  },
  group: {
    box: 'border-emerald-700 bg-emerald-950/70',
    dot: 'bg-emerald-400',
    label: 'Groupe d’occurrences',
  },
}

export interface GraphNodeCardData extends Record<string, unknown> {
  node: GraphNode
  isRoot: boolean
  isExpanded: boolean
}

function GraphNodeCardImpl({ data, selected }: NodeProps) {
  const { node, isRoot, isExpanded } = data as unknown as GraphNodeCardData
  const style = KIND_STYLES[node.kind]
  const fr = IFC_FR[node.entityType]

  return (
    <div
      className={`px-3 py-2 border rounded min-w-[150px] max-w-[230px] transition-shadow ${style.box} ${
        selected ? 'ring-2 ring-blue-400' : ''
      } ${isRoot ? 'ring-2 ring-white/70' : ''}`}
      title={node.globalId ? `GUID : ${node.globalId}` : undefined}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-600 !w-1.5 !h-1.5 !border-0" />

      <div className="flex items-center gap-1.5 mb-0.5">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${style.dot}`} />
        <span className="text-[10px] font-mono text-gray-400 truncate">{node.entityType}</span>
      </div>

      <p className="text-xs text-gray-100 leading-snug break-words">{node.label}</p>

      {fr && node.kind !== 'group' && (
        <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{fr}</p>
      )}

      {node.expandable && (
        <p className="text-[10px] mt-1 text-gray-500">
          {isExpanded ? '• déjà étendu' : '⊕ double-clic pour étendre'}
        </p>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-gray-600 !w-1.5 !h-1.5 !border-0" />
    </div>
  )
}

export const GraphNodeCard = memo(GraphNodeCardImpl)
