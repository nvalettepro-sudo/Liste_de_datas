import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { REL_META } from '../../lib/graphMeta'
import type { GraphRelType } from '../../lib/types'

export interface HubNodeCardData extends Record<string, unknown> {
  relType: GraphRelType
  count: number
}

function HubNodeCardImpl({ data, selected }: NodeProps) {
  const { relType, count } = data as unknown as HubNodeCardData
  const meta = REL_META[relType]

  return (
    <div
      className={`px-4 py-2 rounded-full border-2 bg-gray-950 whitespace-nowrap transition-shadow ${
        selected ? 'ring-2 ring-blue-400' : ''
      }`}
      style={{ borderColor: meta.color }}
    >
      <Handle type="target" position={Position.Left} className="!bg-gray-600 !w-1.5 !h-1.5 !border-0" />
      <span className="text-xs font-mono font-semibold" style={{ color: meta.color }}>
        {meta.label}
      </span>
      <span className="ml-2 text-xs text-gray-500 tabular-nums">×{count.toLocaleString('fr-FR')}</span>
      <Handle type="source" position={Position.Right} className="!bg-gray-600 !w-1.5 !h-1.5 !border-0" />
    </div>
  )
}

export const HubNodeCard = memo(HubNodeCardImpl)
