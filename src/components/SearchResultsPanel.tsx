import { useStore } from '../store/useStore'
import { IFC_FR } from '../lib/ifcTranslations'
import type { GlobalSearchResult } from '../lib/types'

function MatchBadge({ type }: { type: 'pset' | 'property' | 'value' }) {
  const styles = {
    pset: 'bg-violet-900 text-violet-300',
    property: 'bg-blue-900 text-blue-300',
    value: 'bg-teal-900 text-teal-300',
  }
  const labels = { pset: 'Pset', property: 'Propriété', value: 'Valeur' }
  return (
    <span className={`px-1.5 py-0.5 text-xs rounded font-mono ${styles[type]}`}>
      {labels[type]}
    </span>
  )
}

function ResultRow({ result, query }: { result: GlobalSearchResult; query: string }) {
  const selectType = useStore((s) => s.selectType)
  const clearGlobalSearch = useStore((s) => s.clearGlobalSearch)
  const fr = IFC_FR[result.entityType]

  const handleClick = () => {
    selectType(result.entityType)
    clearGlobalSearch()
  }

  const pct = result.totalCount > 0 ? Math.round((result.matchingCount / result.totalCount) * 100) : 0

  return (
    <button
      onClick={handleClick}
      className="w-full text-left px-4 py-3 border-b border-gray-800 hover:bg-gray-800/60 transition-colors group"
    >
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="min-w-0">
          {fr && <p className="text-sm font-medium text-gray-200 leading-tight">{fr}</p>}
          <p className="text-xs font-mono text-gray-500">{result.entityType}</p>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-xs text-gray-400 tabular-nums">{result.matchingCount}/{result.totalCount}</p>
          <p className="text-xs text-gray-600">{pct}%</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {result.matches.slice(0, 5).map((m, i) => (
          <div key={i} className="flex items-center gap-1">
            <MatchBadge type={m.matchType} />
            <span className="text-xs text-gray-400 max-w-xs truncate">
              {m.matchType === 'pset' ? m.psetName : m.propertyName ?? m.psetName}
            </span>
            {m.occurrences > 1 && (
              <span className="text-xs text-gray-600">×{m.occurrences}</span>
            )}
          </div>
        ))}
        {result.matches.length > 5 && (
          <span className="text-xs text-gray-600">+{result.matches.length - 5} autres</span>
        )}
      </div>
    </button>
  )
}

export function SearchResultsPanel() {
  const globalSearchResults = useStore((s) => s.globalSearchResults)
  const searchQuery = useStore((s) => s.searchQuery)
  const clearGlobalSearch = useStore((s) => s.clearGlobalSearch)
  const setSearchQuery = useStore((s) => s.setSearchQuery)

  if (!globalSearchResults) return null

  const handleClose = () => {
    clearGlobalSearch()
    setSearchQuery('')
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-gray-950">
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-900">
        <div>
          <span className="text-sm font-medium text-gray-200">
            Résultats pour « {searchQuery} »
          </span>
          <span className="ml-2 text-xs text-gray-500">
            {globalSearchResults.length} type{globalSearchResults.length !== 1 ? 's' : ''} trouvé{globalSearchResults.length !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          onClick={handleClose}
          className="text-gray-500 hover:text-gray-200 text-sm px-2 py-1 transition-colors"
        >
          ✕ Fermer
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {globalSearchResults.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-600 text-sm italic">Aucun résultat pour « {searchQuery} »</p>
          </div>
        ) : (
          globalSearchResults.map((r) => (
            <ResultRow key={r.entityType} result={r} query={searchQuery} />
          ))
        )}
      </div>
    </div>
  )
}
