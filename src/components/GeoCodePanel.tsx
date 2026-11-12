import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'

/** Libellés des valeurs, identiques à ceux de l'onglet Infos projet. */
export const GEO_KEY_LABEL: Record<string, string> = {
  'geo.latitude': 'Latitude',
  'geo.longitude': 'Longitude',
  'geo.elevation': 'Altitude (RefElevation)',
  'crs.name': 'Système',
  'crs.description': 'Description',
  'crs.geodeticDatum': 'Datum géodésique',
  'crs.verticalDatum': 'Datum vertical',
  'crs.mapProjection': 'Projection',
  'crs.mapZone': 'Zone',
  'crs.mapUnit': 'Unité',
  'site.position': 'Position du site (X, Y, Z)',
  'site.orientation': 'Orientation du site',
  'mc.eastings': 'Eastings (X)',
  'mc.northings': 'Northings (Y)',
  'mc.orthogonalHeight': 'Hauteur orthogonale (Z)',
  'mc.rotation': 'Rotation',
  'mc.scale': 'Échelle',
  'trueNorth': 'Nord vrai',
}

/** Géolocalisation en bleu, géoréférencement en ambre — mêmes familles que l'onglet. */
function tone(key: string) {
  return key.startsWith('geo.')
    ? { base: 'text-sky-300 bg-sky-500/10', focus: 'text-sky-100 bg-sky-500/40 ring-1 ring-sky-300' }
    : { base: 'text-amber-300 bg-amber-500/10', focus: 'text-amber-50 bg-amber-500/40 ring-1 ring-amber-300' }
}

export function GeoCodePanel() {
  const projectInfo = useStore((s) => s.projectInfo)
  const geoCodeKey = useStore((s) => s.geoCodeKey)
  const showGeoCode = useStore((s) => s.showGeoCode)
  const focusRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [geoCodeKey])

  const groups = projectInfo?.geoCode ?? []
  let focusAssigned = false

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-950">
      <div className="flex-shrink-0 px-5 py-3 border-b border-gray-800 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-gray-100 leading-tight">Code IFC — géoréférencement</p>
          <p className="text-xs text-gray-500">
            Valeur sélectionnée :{' '}
            <span className="text-gray-200">{geoCodeKey ? GEO_KEY_LABEL[geoCodeKey] ?? geoCodeKey : '—'}</span>
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-gray-500">
          <span><span className="inline-block w-2 h-2 mr-1 bg-sky-400" />Géolocalisation</span>
          <span><span className="inline-block w-2 h-2 mr-1 bg-amber-400" />Géoréférencement</span>
        </div>
        <button
          onClick={() => showGeoCode(null)}
          className="px-2 py-1 text-xs text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-gray-200 transition-colors"
        >
          ✕ Fermer
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {groups.length === 0 && (
          <p className="text-gray-600 text-sm italic">Aucune ligne de géoréférencement dans ce fichier.</p>
        )}
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{g.title}</h2>
            <div className="border border-gray-800 bg-gray-900/60 divide-y divide-gray-800/70">
              {g.lines.map((l) => (
                <div key={l.id} className="px-3 py-1.5">
                  <p className="text-[10px] text-gray-600 mb-0.5">// {l.note}</p>
                  <code className="block font-mono text-xs text-gray-400 break-all leading-relaxed">
                    {l.head}(
                    {l.args.map((a, i) => {
                      const sep = i < l.args.length - 1 ? ',' : ''
                      if (!a.key) return <span key={i}>{a.text}{sep}</span>
                      const t = tone(a.key)
                      const isFocus = a.key === geoCodeKey
                      const attachRef = isFocus && !focusAssigned
                      if (attachRef) focusAssigned = true
                      return (
                        <span key={i}>
                          <span
                            ref={attachRef ? focusRef : undefined}
                            title={GEO_KEY_LABEL[a.key] ?? a.key}
                            onClick={() => showGeoCode(a.key!)}
                            className={`px-0.5 rounded-sm cursor-pointer ${isFocus ? `${t.focus} font-semibold` : t.base}`}
                          >
                            {a.text}
                          </span>
                          {sep}
                        </span>
                      )
                    })}
                    );
                  </code>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
