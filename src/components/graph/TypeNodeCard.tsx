import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { IFC_FR } from '../../lib/ifcTranslations'
import type { TypeGraphNode } from '../../lib/types'

export interface TypeNodeCardData extends Record<string, unknown> {
  node: TypeGraphNode
}

function TypeNodeCardImpl({ data, selected }: NodeProps) {
  const { node } = data as unknown as TypeNodeCardData
  const fr = IFC_FR[node.entityType]

  return (
    <div
      className={`px-3 py-2 border rounded min-w-[160px] max-w-[220px] bg-slate-900/80 border-slate-600 transition-shadow ${
        selected ? 'ring-2 ring-blue-400' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-600 !w-1.5 !h-1.5 !border-0" />

      <p className="text-xs font-mono text-gray-300 truncate">{node.entityType}</p>
      {fr && <p className="text-[11px] text-gray-500 leading-tight">{fr}</p>}
      <p className="text-lg font-semibold text-gray-100 tabular-nums mt-0.5">
        {node.count.toLocaleString('fr-FR')}
      </p>
      <p className="text-[10px] text-gray-600 mt-1">⊕ double-clic pour explorer</p>

      <Handle type="source" position={Position.Bottom} className="!bg-gray-600 !w-1.5 !h-1.5 !border-0" />
    </div>
  )
}

export const TypeNodeCard = memo(TypeNodeCardImpl)
