import { useStore } from './store/useStore'
import { TopBar } from './components/TopBar'
import { LeftPanel } from './components/LeftPanel'
import { InfoPanel } from './components/InfoPanel'
import { FileDropZone } from './components/FileDropZone'
import { SearchResultsPanel } from './components/SearchResultsPanel'

export function App() {
  const fileName = useStore((s) => s.fileName)
  const error = useStore((s) => s.error)
  const clearError = useStore((s) => s.clearError)
  const isLoading = useStore((s) => s.isLoading)
  const globalSearchResults = useStore((s) => s.globalSearchResults)

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      {!fileName && !isLoading && <FileDropZone />}

      <TopBar />

      <div className="flex flex-1 min-h-0 relative">
        <div className="w-56 flex-shrink-0 min-h-0">
          <LeftPanel />
        </div>
        <InfoPanel />
        {globalSearchResults !== null && <SearchResultsPanel />}
      </div>

      {error && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-red-950 border border-red-800 px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="text-red-400 text-sm flex-1">{error}</span>
            <button
              onClick={clearError}
              className="text-red-600 hover:text-red-300 text-xs flex-shrink-0"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
