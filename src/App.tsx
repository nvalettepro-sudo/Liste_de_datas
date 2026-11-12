import { useStore } from './store/useStore'
import { TopBar } from './components/TopBar'
import { LeftPanel } from './components/LeftPanel'
import { InfoPanel } from './components/InfoPanel'
import { InspectorPanel } from './components/InspectorPanel'
import { FileDropZone } from './components/FileDropZone'
import { SearchResultsPanel } from './components/SearchResultsPanel'
import { GraphView } from './components/graph/GraphView'
import { GraphOverview } from './components/graph/GraphOverview'

export function App() {
  const fileName = useStore((s) => s.fileName)
  const error = useStore((s) => s.error)
  const clearError = useStore((s) => s.clearError)
  const isLoading = useStore((s) => s.isLoading)
  const globalSearchResults = useStore((s) => s.globalSearchResults)
  const graphOpen = useStore((s) => s.graphOpen)
  const graphView = useStore((s) => s.graphView)
  const inspectorOpen = useStore((s) => s.inspectorStack.length > 0 || s.inspectorLoading)

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      {!fileName && !isLoading && <FileDropZone />}

      <TopBar />

      <div className="flex flex-1 min-h-0 relative">
        <div className="w-56 flex-shrink-0 min-h-0">
          <LeftPanel />
        </div>
        {inspectorOpen && !graphOpen ? <InspectorPanel /> : <InfoPanel />}
        {globalSearchResults !== null && <SearchResultsPanel />}
        {graphOpen && (
          <div className="absolute inset-0 z-30 flex">
            <div className="relative flex-1 min-w-0">
              {graphView === 'overview' ? <GraphOverview /> : <GraphView />}
            </div>
            {inspectorOpen && (
              <aside className="w-[620px] max-w-[55vw] flex border-l border-gray-700 flex-shrink-0">
                <InspectorPanel />
              </aside>
            )}
          </div>
        )}
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
