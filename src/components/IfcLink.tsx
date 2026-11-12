import type { ReactNode } from 'react'
import { useStore } from '../store/useStore'
import type { InspectFamily, InspectRequest } from '../lib/types'

/** Une couleur par famille d'information — identique dans les liens et dans l'inspecteur. */
export const FAMILY_STYLE: Record<InspectFamily, { label: string; text: string; active: string; mark: string; focus: string; dot: string }> = {
  geolocation: { label: 'Géolocalisation', text: 'hover:text-sky-200', active: 'text-sky-200 decoration-sky-300', mark: 'text-sky-300 bg-sky-500/10', focus: 'text-sky-50 bg-sky-500/40 ring-1 ring-sky-300', dot: 'bg-sky-400' },
  georeference: { label: 'Géoréférencement', text: 'hover:text-amber-200', active: 'text-amber-200 decoration-amber-300', mark: 'text-amber-300 bg-amber-500/10', focus: 'text-amber-50 bg-amber-500/40 ring-1 ring-amber-300', dot: 'bg-amber-400' },
  project: { label: 'Projet', text: 'hover:text-blue-200', active: 'text-blue-200 decoration-blue-300', mark: 'text-blue-300 bg-blue-500/10', focus: 'text-blue-50 bg-blue-500/40 ring-1 ring-blue-300', dot: 'bg-blue-400' },
  attribute: { label: 'Attribut', text: 'hover:text-teal-200', active: 'text-teal-200 decoration-teal-300', mark: 'text-teal-300 bg-teal-500/10', focus: 'text-teal-50 bg-teal-500/40 ring-1 ring-teal-300', dot: 'bg-teal-400' },
  property: { label: 'Propriété (Pset)', text: 'hover:text-violet-200', active: 'text-violet-200 decoration-violet-300', mark: 'text-violet-300 bg-violet-500/10', focus: 'text-violet-50 bg-violet-500/40 ring-1 ring-violet-300', dot: 'bg-violet-400' },
  relation: { label: 'Relation', text: 'hover:text-rose-200', active: 'text-rose-200 decoration-rose-300', mark: 'text-rose-300 bg-rose-500/10', focus: 'text-rose-50 bg-rose-500/40 ring-1 ring-rose-300', dot: 'bg-rose-400' },
  entity: { label: 'Entité', text: 'hover:text-emerald-200', active: 'text-emerald-200 decoration-emerald-300', mark: 'text-emerald-300 bg-emerald-500/10', focus: 'text-emerald-50 bg-emerald-500/40 ring-1 ring-emerald-300', dot: 'bg-emerald-400' },
}

export function familyOf(request: InspectRequest): InspectFamily {
  switch (request.kind) {
    case 'geo': return request.key.startsWith('geo.') ? 'geolocation' : 'georeference'
    case 'project': return 'project'
    case 'attribute': return 'attribute'
    case 'property': return 'property'
    case 'relations': return 'relation'
    default: return 'entity'
  }
}

const sameRequest = (a: InspectRequest | undefined, b: InspectRequest) =>
  a !== undefined && JSON.stringify(a) === JSON.stringify(b)

/**
 * Rend une information de l'interface cliquable : un clic ouvre, dans
 * l'inspecteur, la ou les lignes du fichier IFC d'où elle provient. Même
 * affordance partout — soulignement pointillé et « ‹› » au survol.
 */
export function IfcLink({
  request,
  children,
  className = '',
  title = 'Voir dans le code IFC',
  stop = false,
  block = false,
}: {
  request: InspectRequest
  children: ReactNode
  className?: string
  title?: string
  /** Empêche la propagation du clic (utile dans un nœud de graphe ou un en-tête repliable). */
  stop?: boolean
  block?: boolean
}) {
  const inspect = useStore((s) => s.inspect)
  const active = useStore((s) => sameRequest(s.inspectorStack[s.inspectorStack.length - 1]?.request, request))
  const style = FAMILY_STYLE[familyOf(request)]
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        if (stop) e.stopPropagation()
        inspect(request)
      }}
      className={`nodrag group/ifc ${block ? 'block w-full' : 'inline'} text-left underline decoration-dotted underline-offset-2 transition-colors ${
        active ? `${style.active} font-medium` : `decoration-gray-700 ${style.text} hover:decoration-current`
      } ${className}`}
    >
      {children}
      <span className={`ml-1 text-[9px] font-mono align-middle ${active ? 'opacity-70' : 'opacity-0 group-hover/ifc:opacity-60'}`}>‹›</span>
    </button>
  )
}
