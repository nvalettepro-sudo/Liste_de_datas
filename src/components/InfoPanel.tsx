import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { IFC_FR } from '../lib/ifcTranslations'
import type { AggregatedEntityData, AggregatedPset, AggregatedProperty, ValueAggregate } from '../lib/types'

function CoverageBadge({ present, total }: { present: number; total: number }) {
  const pct = total > 0 ? Math.round((present / total) * 100) : 0
  const color =
    pct === 100 ? 'text-emerald-400' :
    pct >= 75   ? 'text-blue-400' :
    pct >= 40   ? 'text-yellow-500' :
                  'text-gray-600'
  return (
    <span className={`text-xs tabular-nums flex-shrink-0 ${color}`}>
      {present}/{total} <span className="text-gray-700">({pct}%)</span>
    </span>
  )
}

function AggregateValue({ agg }: { agg: ValueAggregate }) {
  const [expanded, setExpanded] = useState(false)

  if (agg.kind === 'empty') {
    return <span className="text-gray-700 text-xs italic">—</span>
  }

  if (agg.kind === 'numeric') {
    const same = agg.min === agg.max
    return (
      <span className="text-xs text-gray-300 font-mono">
        {same ? agg.min : `${agg.min} … ${agg.max}`}
      </span>
    )
  }

  const values = agg.distinctValues ?? []
  const limit = 3
  const visible = expanded ? values : values.slice(0, limit)
  const hasMore = values.length > limit

  return (
    <div className="text-xs">
      {values.length === 0 ? (
        <span className="text-gray-700 italic">—</span>
      ) : (
        <>
          <div className="space-y-0.5">
            {visible.map((v) => (
              <div key={v.value} className="flex items-baseline gap-1.5">
                <span className="text-gray-200 break-all">{v.value}</span>
                {v.count > 1 && (
                  <span className="text-gray-600 flex-shrink-0">×{v.count}</span>
                )}
              </div>
            ))}
          </div>
          {hasMore && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-1 text-gray-600 hover:text-gray-400 text-xs"
            >
              {expanded
                ? '↑ Réduire'
                : `+ ${values.length - limit} autre${values.length - limit > 1 ? 's' : ''}…`}
            </button>
          )}
        </>
      )}
    </div>
  )
}

function PropRow({ prop, totalCount }: { prop: AggregatedProperty; totalCount: number }) {
  return (
    <div className="py-2 flex gap-2 border-b border-gray-900 last:border-0">
      <div className="w-40 flex-shrink-0">
        <span className="text-xs text-gray-400">{prop.name}</span>
      </div>
      <div className="flex-1 min-w-0">
        <AggregateValue agg={prop.aggregate} />
      </div>
      <CoverageBadge present={prop.aggregate.presentCount} total={totalCount} />
    </div>
  )
}

function PsetBlock({ pset, searchQ }: { pset: AggregatedPset; searchQ: string }) {
  const [open, setOpen] = useState(true)

  const visibleProps = useMemo(() => {
    if (!searchQ) return pset.properties
    const q = searchQ.toLowerCase()
    return pset.properties.filter((p) => {
      if (p.name.toLowerCase().includes(q)) return true
      const vals = p.aggregate.distinctValues ?? []
      return vals.some((v) => v.value.toLowerCase().includes(q))
    })
  }, [pset.properties, searchQ])

  if (searchQ && visibleProps.length === 0) return null

  return (
    <div className="mb-2 border border-gray-800 bg-gray-900/40">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-800/50 transition-colors"
      >
        <span className="text-xs font-mono text-gray-300">{pset.name}</span>
        <div className="flex items-center gap-3">
          <CoverageBadge present={pset.presentCount} total={pset.totalCount} />
          <span className="text-gray-700 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-1 border-t border-gray-800">
          {visibleProps.length === 0 ? (
            <p className="py-2 text-xs text-gray-700 italic">Aucune propriété</p>
          ) : (
            visibleProps.map((p) => (
              <PropRow key={p.name} prop={p} totalCount={pset.totalCount} />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function exportCSV(data: AggregatedEntityData) {
  const rows: string[] = []
  rows.push(['Section', 'Nom', 'Couverture (x/y)', '%', 'Type', 'Valeurs'].join(','))

  const fmt = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

  for (const attr of data.attributes) {
    const agg = attr.aggregate
    const pct = data.totalCount > 0 ? Math.round((agg.presentCount / data.totalCount) * 100) : 0
    const cov = `${agg.presentCount}/${data.totalCount}`
    let valStr = ''
    if (agg.kind === 'numeric') valStr = `${agg.min} … ${agg.max}`
    else if (agg.distinctValues) valStr = agg.distinctValues.map((v) => `${v.value} (×${v.count})`).join(' | ')
    rows.push([fmt('Attributs'), fmt(attr.name), fmt(cov), fmt(pct + '%'), fmt(agg.kind), fmt(valStr)].join(','))
  }

  for (const pset of [...data.standardPsets, ...data.customPsets]) {
    const section = pset.isStandard ? 'Pset Standard' : 'Pset Personnalisé'
    const pctPset = data.totalCount > 0 ? Math.round((pset.presentCount / data.totalCount) * 100) : 0
    rows.push([fmt(section), fmt(pset.name), fmt(`${pset.presentCount}/${pset.totalCount}`), fmt(pctPset + '%'), fmt('pset'), fmt('')].join(','))
    for (const prop of pset.properties) {
      const agg = prop.aggregate
      const pct = data.totalCount > 0 ? Math.round((agg.presentCount / data.totalCount) * 100) : 0
      const cov = `${agg.presentCount}/${data.totalCount}`
      let valStr = ''
      if (agg.kind === 'numeric') valStr = `${agg.min} … ${agg.max}`
      else if (agg.distinctValues) valStr = agg.distinctValues.map((v) => `${v.value} (×${v.count})`).join(' | ')
      rows.push([fmt(section + ' > ' + pset.name), fmt(prop.name), fmt(cov), fmt(pct + '%'), fmt(agg.kind), fmt(valStr)].join(','))
    }
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${data.entityType}_agrege.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function InfoPanel() {
  const selectedType = useStore((s) => s.selectedType)
  const aggregatedData = useStore((s) => s.aggregatedData)
  const searchQuery = useStore((s) => s.searchQuery)
  const isLoading = useStore((s) => s.isLoading)

  const searchQ = searchQuery.trim().toLowerCase()

  const filteredStandard = useMemo(() => {
    if (!aggregatedData || !searchQ) return aggregatedData?.standardPsets ?? []
    return aggregatedData.standardPsets.filter(
      (p) =>
        p.name.toLowerCase().includes(searchQ) ||
        p.properties.some(
          (prop) =>
            prop.name.toLowerCase().includes(searchQ) ||
            (prop.aggregate.distinctValues ?? []).some((v) => v.value.toLowerCase().includes(searchQ))
        )
    )
  }, [aggregatedData, searchQ])

  const filteredCustom = useMemo(() => {
    if (!aggregatedData || !searchQ) return aggregatedData?.customPsets ?? []
    return aggregatedData.customPsets.filter(
      (p) =>
        p.name.toLowerCase().includes(searchQ) ||
        p.properties.some(
          (prop) =>
            prop.name.toLowerCase().includes(searchQ) ||
            (prop.aggregate.distinctValues ?? []).some((v) => v.value.toLowerCase().includes(searchQ))
        )
    )
  }, [aggregatedData, searchQ])

  const filteredAttrs = useMemo(() => {
    if (!aggregatedData || !searchQ) return aggregatedData?.attributes ?? []
    return aggregatedData.attributes.filter(
      (a) =>
        a.name.toLowerCase().includes(searchQ) ||
        (a.aggregate.distinctValues ?? []).some((v) => v.value.toLowerCase().includes(searchQ))
    )
  }, [aggregatedData, searchQ])

  if (!selectedType) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950">
        <p className="text-gray-600 text-sm">Sélectionner un type dans la liste</p>
      </div>
    )
  }

  if (isLoading && !aggregatedData) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950">
        <p className="text-gray-600 text-sm">Calcul en cours…</p>
      </div>
    )
  }

  if (!aggregatedData) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950">
        <p className="text-gray-600 text-sm">Aucune donnée</p>
      </div>
    )
  }

  const fr = IFC_FR[aggregatedData.entityType]

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-950">
      <div className="flex-shrink-0 px-5 py-3 border-b border-gray-800 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {fr && <p className="text-base font-semibold text-gray-100 leading-tight">{fr}</p>}
          <p className="text-xs font-mono text-gray-500">{aggregatedData.entityType}</p>
        </div>
        <span className="text-sm text-gray-500 flex-shrink-0">
          {aggregatedData.totalCount.toLocaleString('fr-FR')} occurrence{aggregatedData.totalCount > 1 ? 's' : ''}
        </span>
        <button
          onClick={() => exportCSV(aggregatedData)}
          className="px-2 py-1 text-xs text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-gray-200 transition-colors flex-shrink-0"
        >
          Exporter CSV
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

        {filteredAttrs.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Attributs
            </h2>
            <div className="border border-gray-800 bg-gray-900/40">
              <div className="px-3 py-1 border-b border-gray-800 flex gap-2 text-xs text-gray-600">
                <span className="w-40 flex-shrink-0">Attribut</span>
                <span className="flex-1">Valeurs</span>
                <span className="flex-shrink-0">Couverture</span>
              </div>
              <div className="px-3">
                {filteredAttrs.map((attr) => (
                  <PropRow key={attr.name} prop={attr} totalCount={aggregatedData.totalCount} />
                ))}
              </div>
            </div>
          </section>
        )}

        {filteredStandard.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Pset Standards
            </h2>
            {filteredStandard.map((pset) => (
              <PsetBlock key={pset.name} pset={pset} searchQ={searchQ} />
            ))}
          </section>
        )}

        {filteredCustom.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Pset Personnalisés
            </h2>
            {filteredCustom.map((pset) => (
              <PsetBlock key={pset.name} pset={pset} searchQ={searchQ} />
            ))}
          </section>
        )}

        {searchQ && filteredAttrs.length === 0 && filteredStandard.length === 0 && filteredCustom.length === 0 && (
          <p className="text-gray-700 text-sm italic text-center py-8">
            Aucun résultat pour « {searchQuery} »
          </p>
        )}

        {!searchQ && aggregatedData.standardPsets.length === 0 && aggregatedData.customPsets.length === 0 && (
          <p className="text-gray-700 text-sm italic text-center py-4">
            Aucun Pset trouvé sur ces instances
          </p>
        )}
      </div>
    </div>
  )
}
