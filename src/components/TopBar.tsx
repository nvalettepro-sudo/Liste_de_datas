import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'
import { version } from '../../package.json'

const VERSION_COLORS: Record<string, string> = {
  IFC2X3: 'bg-indigo-800 text-indigo-200',
  IFC4: 'bg-blue-800 text-blue-200',
  IFC4X3: 'bg-cyan-800 text-cyan-200',
}

export function TopBar() {
  const fileName = useStore((s) => s.fileName)
  const ifcVersion = useStore((s) => s.ifcVersion)
  const isLoading = useStore((s) => s.isLoading)
  const loadProgress = useStore((s) => s.loadProgress)
  const loadPhase = useStore((s) => s.loadPhase)
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const triggerGlobalSearch = useStore((s) => s.triggerGlobalSearch)
  const clearGlobalSearch = useStore((s) => s.clearGlobalSearch)
  const isSearching = useStore((s) => s.isSearching)
  const loadFile = useStore((s) => s.loadFile)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = searchQuery.trim()
    if (!q) {
      clearGlobalSearch()
      return
    }
    debounceRef.current = setTimeout(() => {
      triggerGlobalSearch()
    }, 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchQuery])

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) loadFile(file)
    e.target.value = ''
  }

  return (
    <div className="flex-shrink-0">
      <div className="flex items-center h-12 px-4 gap-4 bg-gray-900 border-b border-gray-800">
        <label
          htmlFor="topbar-file"
          className="flex items-center gap-2 cursor-pointer group"
          title="Charger un nouveau fichier"
        >
          <div className="w-5 h-5 text-gray-500 group-hover:text-gray-300 transition-colors">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <span className="text-sm font-medium text-gray-200 group-hover:text-white transition-colors max-w-xs truncate">
            {fileName ?? 'Charger un fichier…'}
          </span>
          <input
            id="topbar-file"
            type="file"
            accept=".ifc"
            className="sr-only"
            onChange={handleFile}
          />
        </label>

        {ifcVersion && (
          <span
            className={`px-2 py-0.5 text-xs font-mono rounded ${VERSION_COLORS[ifcVersion] ?? 'bg-gray-700 text-gray-300'}`}
          >
            {ifcVersion}
          </span>
        )}

        <div className="flex-1" />

        <span className="text-xs font-mono text-gray-600">v{version}</span>

        <div className="relative">
          <input
            type="text"
            placeholder="Rechercher un Pset, propriété, valeur…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-80 h-8 px-3 pr-8 text-sm bg-gray-800 border border-gray-700 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
          />
          {isSearching ? (
            <span className="absolute right-2.5 top-2 w-4 h-4 text-blue-400 text-xs animate-pulse">…</span>
          ) : searchQuery ? (
            <button
              onClick={() => { setSearchQuery(''); clearGlobalSearch() }}
              className="absolute right-2.5 top-1.5 w-4 h-4 text-gray-500 hover:text-gray-300 text-sm leading-none"
            >
              ✕
            </button>
          ) : (
            <svg
              className="absolute right-2.5 top-2 w-4 h-4 text-gray-600"
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

      {isLoading && (
        <div className="h-1 bg-gray-800 relative overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-blue-600 transition-all duration-200"
            style={{ width: `${loadProgress}%` }}
          />
        </div>
      )}
      {isLoading && loadPhase && (
        <div className="px-4 py-1 text-xs text-gray-500 bg-gray-900 border-b border-gray-800">
          {loadPhase}
        </div>
      )}
    </div>
  )
}
