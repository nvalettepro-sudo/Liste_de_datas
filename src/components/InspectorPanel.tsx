import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../store/useStore'
import { FAMILY_STYLE } from './IfcLink'
import type { InspectArg, InspectLine, InspectOccurrence, InspectResult } from '../lib/types'

/** Découpe un argument en segments texte / référence « #N » cliquable. */
function RefText({ text, onRef }: { text: string; onRef: (id: number) => void }) {
  const parts = text.split(/(#\d+)/g)
  return (
    <>
      {parts.map((p, i) =>
        /^#\d+$/.test(p) ? (
          <button
            key={i}
            type="button"
            onClick={() => onRef(Number(p.slice(1)))}
            title={`Ouvrir ${p}`}
            className="text-gray-300 underline decoration-dotted decoration-gray-600 underline-offset-2 hover:text-white hover:decoration-white"
          >
            {p}
          </button>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  )
}

function Arg({
  arg,
  isFocus,
  mark,
  focus,
  onRef,
  focusRef,
}: {
  arg: InspectArg
  isFocus: boolean
  mark: string
  focus: string
  onRef: (id: number) => void
  focusRef?: (el: HTMLSpanElement | null) => void
}) {
  const inner = arg.refs ? <RefText text={arg.text} onRef={onRef} /> : arg.text
  if (!arg.key) {
    return (
      <span title={arg.name} className={arg.name ? 'hover:text-gray-200 hover:bg-gray-800 rounded-sm' : ''}>
        {inner}
      </span>
    )
  }
  return (
    <span
      ref={focusRef}
      title={arg.name}
      className={`px-0.5 rounded-sm ${isFocus ? `${focus} font-semibold` : mark}`}
    >
      {inner}
    </span>
  )
}

function Line({
  line,
  result,
  onRef,
  focusRef,
}: {
  line: InspectLine
  result: InspectResult
  onRef: (id: number) => void
  focusRef: (el: HTMLSpanElement | null) => void
}) {
  const style = FAMILY_STYLE[result.family]
  const [showNames, setShowNames] = useState(false)
  const namedArgs = line.args.filter((a) => a.name)
  return (
    <div className="px-3 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        {line.note && <p className="text-[10px] text-gray-600 mb-0.5">// {line.note}</p>}
        {namedArgs.length > 0 && (
          <button
            type="button"
            onClick={() => setShowNames(!showNames)}
            className="ml-auto text-[10px] text-gray-600 hover:text-gray-400"
            title="Afficher le nom de chaque attribut selon le schéma IFC"
          >
            {showNames ? 'masquer les attributs' : 'attributs'}
          </button>
        )}
      </div>
      <code className="block font-mono text-xs text-gray-400 break-all leading-relaxed">
        {line.id > 0 ? <span className="text-gray-300">#{line.id}=</span> : null}
        <span className="text-gray-300">{line.typeName}</span>(
        {line.args.map((a, i) => {
          const isFocus = !!a.key && (a.key === result.focusKey || a.key === 'focus' || !!result.focusKeys?.includes(a.key))
          return (
            <span key={i}>
              <Arg arg={a} isFocus={isFocus} mark={style.mark} focus={style.focus} onRef={onRef} focusRef={isFocus ? focusRef : undefined} />
              {i < line.args.length - 1 ? ',' : ''}
            </span>
          )
        })}
        );
      </code>
      {showNames && (
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0 text-[10px] font-mono">
          {line.args.map((a, i) => (
            <div key={i} className="contents">
              <dt className="text-gray-600">{i + 1}. {a.name ?? '—'}</dt>
              <dd className={`truncate ${a.key ? 'text-gray-200' : 'text-gray-500'}`}>{a.text}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

function Occurrences({
  result,
  selected,
  onPick,
}: {
  result: InspectResult
  selected: number | null
  onPick: (o: InspectOccurrence, idx: number) => void
}) {
  const [filter, setFilter] = useState('')
  const items = result.occurrences!.items
  const total = result.occurrences!.total
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return items.map((o, i) => [o, i] as const)
    return items
      .map((o, i) => [o, i] as const)
      .filter(([o]) => `${o.id} ${o.label ?? ''} ${o.value ?? ''} ${o.typeName}`.toLowerCase().includes(q))
  }, [items, filter])

  return (
    <div className="w-72 flex-shrink-0 border-r border-gray-800 flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-gray-800 flex-shrink-0">
        <p className="text-[11px] text-gray-500 mb-1.5">
          {items.length < total
            ? `${items.length} premières sur ${total.toLocaleString('fr-FR')} occurrences`
            : `${total.toLocaleString('fr-FR')} occurrence${total > 1 ? 's' : ''}`}
        </p>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrer (#id, nom, valeur)…"
          className="w-full h-7 px-2 text-xs bg-gray-900 border border-gray-800 text-gray-300 placeholder-gray-700 focus:outline-none focus:border-gray-600"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {visible.map(([o, i]) => (
          <button
            key={`${o.id}-${i}`}
            type="button"
            onClick={() => onPick(o, i)}
            className={`w-full text-left px-3 py-1.5 border-b border-gray-900 hover:bg-gray-800/60 ${
              selected === i ? 'bg-gray-800' : ''
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-gray-200 truncate">{o.label ?? o.typeName}</span>
              <span className="text-[10px] font-mono text-gray-500 flex-shrink-0">#{o.id}</span>
            </div>
            {o.value !== null && <p className="text-[11px] text-gray-400 truncate">{o.value}</p>}
            {o.label && o.typeName !== o.label && (
              <p className="text-[10px] font-mono text-gray-600 truncate">{o.typeName}</p>
            )}
          </button>
        ))}
        {visible.length === 0 && <p className="px-3 py-4 text-xs text-gray-700 italic">Aucune occurrence</p>}
      </div>
    </div>
  )
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-800 text-gray-400 border border-gray-700">{children}</span>
}

/**
 * Inspecteur IFC : affiche les lignes STEP d'où proviennent les informations
 * de l'application, avec l'argument concerné mis en évidence, les références
 * « #N » navigables (pile avec retour) et, pour les valeurs agrégées, la liste
 * des occurrences.
 */
export function InspectorPanel() {
  const stack = useStore((s) => s.inspectorStack)
  const loading = useStore((s) => s.inspectorLoading)
  const selected = useStore((s) => s.inspectorOccurrence)
  const inspect = useStore((s) => s.inspect)
  const inspectBack = useStore((s) => s.inspectBack)
  const closeInspector = useStore((s) => s.closeInspector)
  const result = stack[stack.length - 1]
  const focusEl = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    focusEl.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [result])

  const onRef = (id: number) => inspect({ kind: 'entity', id }, 'push')

  if (!result) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950">
        <p className="text-gray-600 text-sm">{loading ? 'Lecture du fichier…' : 'Aucune information sélectionnée'}</p>
      </div>
    )
  }

  const style = FAMILY_STYLE[result.family]
  const lineCount = result.groups.reduce((n, g) => n + g.lines.length, 0)

  return (
    <div data-inspector className="flex-1 flex flex-col min-h-0 bg-gray-950 min-w-0">
      <div className="flex-shrink-0 px-4 py-2.5 border-b border-gray-800 flex items-center gap-3">
        {stack.length > 1 && (
          <button
            type="button"
            onClick={inspectBack}
            className="px-2 py-1 text-xs text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-gray-200"
            title="Revenir à la ligne précédente"
          >
            ← Retour
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />
            <p className="text-sm font-semibold text-gray-100 leading-tight truncate" title={result.title}>
              {result.title}
            </p>
            <Chip>{style.label}</Chip>
            {loading && <span className="text-xs text-blue-400 animate-pulse">…</span>}
          </div>
          <p className="text-[11px] text-gray-500 truncate">
            {result.subtitle ?? `${lineCount} ligne${lineCount > 1 ? 's' : ''} du fichier IFC`}
            {stack.length > 1 && <span className="text-gray-700"> · profondeur {stack.length}</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={closeInspector}
          className="px-2 py-1 text-xs text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-gray-200"
        >
          ✕ Fermer
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {result.occurrences && result.occurrences.items.length > 0 && (
          <Occurrences
            result={result}
            selected={selected}
            onPick={(o) => inspect({ kind: 'chain', ids: o.chain, focusId: o.focusId, focusAttr: o.focusAttr }, 'occurrence')}
          />
        )}

        <div className="flex-1 min-w-0 overflow-y-auto px-4 py-3 space-y-4">
          {result.groups.length === 0 && (
            <p className="text-gray-600 text-sm italic">Aucune ligne correspondante dans le fichier.</p>
          )}
          {result.groups.map((g) => (
            <section key={g.title}>
              <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{g.title}</h2>
              <div className="border border-gray-800 bg-gray-900/60 divide-y divide-gray-800/70">
                {g.lines.map((l, i) => (
                  <Line key={`${l.id}-${i}`} line={l} result={result} onRef={onRef} focusRef={(el) => { if (el) focusEl.current = el }} />
                ))}
              </div>
            </section>
          ))}
          <p className="text-[10px] text-gray-700 pt-2">
            Texte brut du fichier STEP. Survolez un argument pour voir son nom d'attribut ; cliquez une référence
            <span className="font-mono"> #N</span> pour l'ouvrir.
          </p>
        </div>
      </div>
    </div>
  )
}
