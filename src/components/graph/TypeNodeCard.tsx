import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { IFC_FR } from '../../lib/ifcTranslations'
import { useStore } from '../../store/useStore'
import type { TypeGraphNode } from '../../lib/types'

export interface TypeNodeCardData extends Record<string, unknown> {
  node: TypeGraphNode
}

function TypeNodeCardImpl({ id, data, selected }: NodeProps) {
  const { node } = data as unknown as TypeNodeCardData
  const fr = IFC_FR[node.entityType]
  const resetOverviewNodePosition = useStore((s) => s.resetOverviewNodePosition)

  return (
    <div
      className={`group relative px-3 py-2 border rounded min-w-[160px] max-w-[220px] bg-slate-900/80 border-slate-600 transition-shadow ${
        selected ? 'ring-2 ring-blue-400' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-600 !w-1.5 !h-1.5 !border-0" />

      <button
        type="button"
        className="nodrag absolute top-1 right-1 w-4 h-4 flex items-center justify-center text-gray-600 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Recaler sous son en-tête"
        onClick={(e) => {
          e.stopPropagation()
          resetOverviewNodePosition(id)
        }}
      >
        ⟲
      </button>

      <p className="text-sm font-semibold text-gray-100 truncate pr-3">{fr ?? node.entityType}</p>
      {fr && <p className="text-[11px] font-mono text-gray-500 leading-tight truncate">{node.entityType}</p>}
      <p className="text-xs text-gray-500 tabular-nums mt-1">{node.count.toLocaleString('fr-FR')}</p>
      <p className="text-[10px] text-gray-600 mt-1">⊕ double-clic pour explorer</p>

      <Handle type="source" position={Position.Bottom} className="!bg-gray-600 !w-1.5 !h-1.5 !border-0" />
    </div>
  )
}

export const TypeNodeCard = memo(TypeNodeCardImpl)
