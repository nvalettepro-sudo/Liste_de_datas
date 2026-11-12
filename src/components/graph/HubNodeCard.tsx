import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { REL_META } from '../../lib/graphMeta'
import type { GraphRelType, InspectRequest } from '../../lib/types'
import { IfcLink } from '../IfcLink'

export interface HubNodeCardData extends Record<string, unknown> {
  relType: GraphRelType
  count: number
  /** Requête inspecteur pour voir les lignes IfcRel… de ce hub. */
  inspectRequest?: InspectRequest
}

function HubNodeCardImpl({ data, selected }: NodeProps) {
  const { relType, count, inspectRequest } = data as unknown as HubNodeCardData
  const meta = REL_META[relType]

  return (
    <div
      className={`px-4 py-2 rounded-xl border-2 bg-gray-950 whitespace-nowrap transition-shadow ${
        selected ? 'ring-2 ring-blue-400' : ''
      }`}
      style={{ borderColor: meta.color }}
    >
      <Handle type="target" position={Position.Left} className="!bg-gray-600 !w-1.5 !h-1.5 !border-0" />
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold" style={{ color: meta.color }}>
          {meta.label}
        </span>
        {inspectRequest ? (
          <IfcLink request={inspectRequest} stop className="text-xs text-gray-500 tabular-nums" title="Voir les relations dans le code IFC">
            ×{count.toLocaleString('fr-FR')}
          </IfcLink>
        ) : (
          <span className="text-xs text-gray-500 tabular-nums">×{count.toLocaleString('fr-FR')}</span>
        )}
      </div>
      <p className="text-[10px] font-mono text-gray-600 mt-0.5">{relType}</p>
      <Handle type="source" position={Position.Right} className="!bg-gray-600 !w-1.5 !h-1.5 !border-0" />
    </div>
  )
}

export const HubNodeCard = memo(HubNodeCardImpl)
