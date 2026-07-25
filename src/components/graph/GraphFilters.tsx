import { useMemo } from 'react'
import { useStore } from '../../store/useStore'
import { GRAPH_REL_TYPES } from '../../lib/types'
import { REL_META } from '../../lib/graphMeta'
import { KIND_STYLES } from './GraphNodeCard'
import type { GraphNode } from '../../lib/types'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-gray-800 px-3 py-3">
      <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
        {title}
      </h3>
      {children}
    </section>
  )
}

export function GraphFilters() {
  const graphNodes = useStore((s) => s.graphNodes)
  const graphRelTypes = useStore((s) => s.graphRelTypes)
  const toggleGraphRelType = useStore((s) => s.toggleGraphRelType)
  const graphEntityFilter = useStore((s) => s.graphEntityFilter)
  const setGraphEntityFilter = useStore((s) => s.setGraphEntityFilter)
  const graphStoreyFilter = useStore((s) => s.graphStoreyFilter)
  const setGraphStoreyFilter = useStore((s) => s.setGraphStoreyFilter)

  const entityTypes = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of graphNodes) {
      counts.set(n.entityType, (counts.get(n.entityType) ?? 0) + 1)
    }
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [graphNodes])

  const storeys = useMemo(
    () => graphNodes.filter((n: GraphNode) => n.kind === 'spatial'),
    [graphNodes]
  )

  const toggleEntity = (type: string) => {
    const active = graphEntityFilter ?? entityTypes.map(([t]) => t)
    const next = active.includes(type) ? active.filter((t) => t !== type) : [...active, type]
    setGraphEntityFilter(next.length === entityTypes.length ? null : next)
  }

  const isEntityActive = (type: string) => !graphEntityFilter || graphEntityFilter.includes(type)

  return (
    <div className="w-60 flex-shrink-0 border-r border-gray-800 bg-gray-900 overflow-y-auto">
      <Section title="Relations affichées">
        <div className="space-y-1.5">
          {GRAPH_REL_TYPES.map((rel) => {
            const meta = REL_META[rel]
            const checked = graphRelTypes.includes(rel)
            const isHeavy = rel === 'IfcRelDefinesByProperties'
            return (
              <label
                key={rel}
                className="flex items-start gap-2 cursor-pointer group"
                title={meta.hint}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleGraphRelType(rel)}
                  className="mt-0.5 accent-blue-600"
                />
                <span className="min-w-0">
                  <span
                    className="text-xs text-gray-300 group-hover:text-gray-100"
                    style={{ color: checked ? meta.color : undefined }}
                  >
                    {meta.label}
                  </span>
                  {isHeavy && (
                    <span className="block text-[10px] text-gray-600 leading-tight">
                      hors index par défaut
                    </span>
                  )}
                </span>
              </label>
            )
          })}
        </div>
        {graphRelTypes.length === 0 && (
          <p className="mt-2 text-[10px] text-amber-500">
            Sélectionner au moins une relation.
          </p>
        )}
      </Section>

      <Section title="Types d'entité">
        {entityTypes.length === 0 ? (
          <p className="text-[10px] text-gray-600 italic">—</p>
        ) : (
          <div className="space-y-1">
            {entityTypes.map(([type, count]) => (
              <label key={type} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={isEntityActive(type)}
                  onChange={() => toggleEntity(type)}
                  className="accent-blue-600"
                />
                <span className="text-xs font-mono text-gray-400 group-hover:text-gray-200 truncate flex-1">
                  {type}
                </span>
                <span className="text-[10px] text-gray-600 tabular-nums">{count}</span>
              </label>
            ))}
          </div>
        )}
        {graphEntityFilter && (
          <button
            onClick={() => setGraphEntityFilter(null)}
            className="mt-2 text-[10px] text-blue-500 hover:text-blue-400"
          >
            Tout afficher
          </button>
        )}
      </Section>

      <Section title="Structure spatiale">
        {storeys.length === 0 ? (
          <p className="text-[10px] text-gray-600 italic">
            Aucun nœud spatial dans le graphe courant.
          </p>
        ) : (
          <select
            value={graphStoreyFilter ?? ''}
            onChange={(e) => setGraphStoreyFilter(e.target.value || null)}
            className="w-full h-7 px-2 text-xs bg-gray-800 border border-gray-700 text-gray-200 focus:outline-none focus:border-blue-600"
          >
            <option value="">Tous</option>
            {storeys.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        )}
      </Section>

      <Section title="Légende">
        <div className="space-y-1">
          {(Object.keys(KIND_STYLES) as Array<keyof typeof KIND_STYLES>).map((kind) => (
            <div key={kind} className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${KIND_STYLES[kind].dot}`} />
              <span className="text-[10px] text-gray-500">{KIND_STYLES[kind].label}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
