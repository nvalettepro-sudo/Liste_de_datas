import { useCallback, useRef, useState } from 'react'
import { useStore } from './store/useStore'
import { TopBar } from './components/TopBar'
import { LeftPanel } from './components/LeftPanel'
import { InfoPanel } from './components/InfoPanel'
import { InspectorPanel } from './components/InspectorPanel'
import { FileDropZone } from './components/FileDropZone'
import { SearchResultsPanel } from './components/SearchResultsPanel'
import { GraphView } from './components/graph/GraphView'
import { GraphOverview } from './components/graph/GraphOverview'

const LEFT_DEFAULT = 224
const LEFT_MIN = 180
const LEFT_KEY = 'leftPanelWidth'

const clampLeft = (w: number) => Math.round(Math.min(Math.max(w, LEFT_MIN), Math.max(LEFT_MIN, window.innerWidth * 0.6)))

function readLeftWidth(): number {
  try {
    const v = Number(localStorage.getItem(LEFT_KEY))
    return v > 0 ? clampLeft(v) : LEFT_DEFAULT
  } catch {
    return LEFT_DEFAULT
  }
}

/**
 * Largeur de la barre latérale, réglable à la souris par sa bordure droite
 * (double-clic : largeur par défaut) et mémorisée dans le navigateur.
 */
function useLeftWidth() {
  const [width, setWidth] = useState(readLeftWidth)
  const drag = useRef<{ startX: number; startW: number } | null>(null)

  const save = (w: number) => {
    try { localStorage.setItem(LEFT_KEY, String(w)) } catch { /* stockage indisponible */ }
  }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startW: width }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [width])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    setWidth(clampLeft(drag.current.startW + e.clientX - drag.current.startX))
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    setWidth((w) => { save(w); return w })
  }, [])

  const reset = useCallback(() => { setWidth(LEFT_DEFAULT); save(LEFT_DEFAULT) }, [])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    setWidth((w) => { const n = clampLeft(w + (e.key === 'ArrowRight' ? step : -step)); save(n); return n })
  }, [])

  return { width, handle: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onDoubleClick: reset, onKeyDown } }
}

export function App() {
  const fileName = useStore((s) => s.fileName)
  const error = useStore((s) => s.error)
  const clearError = useStore((s) => s.clearError)
  const isLoading = useStore((s) => s.isLoading)
  const globalSearchResults = useStore((s) => s.globalSearchResults)
  const graphOpen = useStore((s) => s.graphOpen)
  const graphView = useStore((s) => s.graphView)
  const inspectorOpen = useStore((s) => s.inspectorStack.length > 0 || s.inspectorLoading)
  const left = useLeftWidth()

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      {!fileName && !isLoading && <FileDropZone />}

      <TopBar />

      <div className="flex flex-1 min-h-0 relative">
        <div data-left-panel className="relative flex-shrink-0 min-h-0" style={{ width: left.width }}>
          <LeftPanel />
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionner la barre latérale"
            aria-valuenow={left.width}
            tabIndex={0}
            title="Glisser pour redimensionner · double-clic : largeur par défaut"
            {...left.handle}
            className="absolute top-0 -right-1 bottom-0 w-2 z-20 cursor-col-resize group focus:outline-none"
          >
            <div className="mx-auto h-full w-px bg-transparent group-hover:bg-blue-500 group-active:bg-blue-400 group-focus-visible:bg-blue-500 transition-colors" />
          </div>
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
