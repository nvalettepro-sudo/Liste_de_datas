import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { IFC_FR, ALLOWED_IFC_TYPES } from '../lib/ifcTranslations'
import type { EntityTypeSummary } from '../lib/types'

type SortMode = 'count' | 'alpha'

function EntityRow({
  summary,
  selected,
  maxCount,
  onClick,
}: {
  summary: EntityTypeSummary
  selected: boolean
  maxCount: number
  onClick: () => void
}) {
  const fr = IFC_FR[summary.type]
  const barWidth = maxCount > 0 ? (summary.count / maxCount) * 100 : 0

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 group focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 ${
        selected ? 'bg-blue-900/60' : 'hover:bg-gray-800'
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex flex-col min-w-0 flex-1">
          {fr && (
            <span
              className={`text-xs font-medium truncate leading-tight ${
                selected ? 'text-blue-100' : 'text-gray-200 group-hover:text-white'
              }`}
            >
              {fr}
            </span>
          )}
          <span
            className={`text-xs font-mono truncate leading-tight ${
              selected ? 'text-blue-300' : 'text-gray-500'
            }`}
          >
            {summary.type}
          </span>
        </div>
        <span
          className={`text-xs tabular-nums flex-shrink-0 ${
            selected ? 'text-blue-300' : 'text-gray-600'
          }`}
        >
          {summary.count.toLocaleString('fr-FR')}
        </span>
      </div>
      <div className="mt-1 h-0.5 bg-gray-800">
        <div
          className={`h-full transition-all duration-300 ${
            selected ? 'bg-blue-500' : 'bg-gray-700'
          }`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
    </button>
  )
}

export function LeftPanel() {
  const allEntityTypes = useStore((s) => s.entityTypes)
  const selectedType = useStore((s) => s.selectedType)
  const selectType = useStore((s) => s.selectType)

  const [sortMode, setSortMode] = useState<SortMode>('count')
  const [search, setSearch] = useState('')

  const entityTypes = useMemo(() => {
    const q = search.trim().toLowerCase()

    let filtered = allEntityTypes.filter((s) => {
      if (!ALLOWED_IFC_TYPES.has(s.type)) return false
      if (!q) return true
      const fr = IFC_FR[s.type]?.toLowerCase() ?? ''
      return s.type.toLowerCase().includes(q) || fr.includes(q)
    })

    if (sortMode === 'alpha') {
      filtered = [...filtered].sort((a, b) => a.type.localeCompare(b.type))
    }

    return filtered
  }, [allEntityTypes, sortMode, search])

  const maxCount = useMemo(
    () => (entityTypes.length > 0 ? Math.max(...entityTypes.map((e) => e.count)) : 1),
    [entityTypes]
  )

  return (
    <div className="flex flex-col h-full border-r border-gray-800 bg-gray-950">
      <div className="px-3 py-2 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-500">
            Liste des entités IFC — {entityTypes.length}
          </span>
          <div className="flex gap-0.5 text-xs">
            <button
              onClick={() => setSortMode('count')}
              title="Trier par quantité"
              className={`px-1.5 py-0.5 transition-colors ${
                sortMode === 'count' ? 'text-blue-400' : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              #
            </button>
            <button
              onClick={() => setSortMode('alpha')}
              title="Trier alphabétiquement"
              className={`px-1.5 py-0.5 transition-colors ${
                sortMode === 'alpha' ? 'text-blue-400' : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              A↓
            </button>
          </div>
        </div>

        <div className="relative">
          <input
            type="text"
            placeholder="IfcWall, Mur…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-7 px-2 pr-6 text-xs bg-gray-900 border border-gray-800 text-gray-300 placeholder-gray-700 focus:outline-none focus:border-gray-600"
          />
          {search ? (
            <button
              onClick={() => setSearch('')}
              className="absolute right-1.5 top-1 text-gray-600 hover:text-gray-400 text-xs leading-none"
            >
              ✕
            </button>
          ) : (
            <svg
              className="absolute right-1.5 top-1.5 w-3.5 h-3.5 text-gray-700"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {entityTypes.length === 0 && search && (
          <p className="px-3 py-4 text-xs text-gray-700 italic">
            Aucun résultat pour « {search} »
          </p>
        )}
        {entityTypes.map((s) => (
          <EntityRow
            key={s.type}
            summary={s}
            selected={s.type === selectedType}
            maxCount={maxCount}
            onClick={() => selectType(s.type)}
          />
        ))}
      </div>
    </div>
  )
}
