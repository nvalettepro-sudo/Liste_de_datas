import { useState, type ReactNode } from 'react'
import { IfcLink } from './IfcLink'
import { STATUS_INFO, GEO_LABELS, certaintyBadge } from '../lib/georefLabels'
import type { Certainty, GeoAnalysis, InspectRequest } from '../lib/types'

/* ---------- Mise en forme (§7.5) ---------- */

/** Longueur : 3 décimales (mm), en mètres ; valeurs < 1e-6 m affichées 0. */
const fmtLen = (v: number | null | undefined, toM: number) => {
  if (v === null || v === undefined) return null
  const m = v * toM
  return (Math.abs(m) < 1e-6 ? 0 : m).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}
/** Latitude / longitude décimales : 6 décimales. */
const dec6 = (v: number) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 6, maximumFractionDigits: 6 })}°`
/** Angle : 2 décimales. */
const fmtAng = (v: number | null | undefined) =>
  v === null || v === undefined ? null : `${(Math.abs(v) < 5e-3 ? 0 : v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}°`

/* ---------- Briques ---------- */

function CertaintyBadge({ c, schema }: { c: Certainty; schema: string }) {
  const b = certaintyBadge(c, schema)
  if (!b) return null
  const hyp = c === 'HYPOTHESE'
  return (
    <span
      title={b.title}
      className={`inline-block align-middle ml-1 px-1 py-px text-[9px] leading-tight rounded border cursor-help ${
        hyp ? 'border-amber-700 text-amber-300 bg-amber-950/40' : 'border-slate-600 text-slate-300 bg-slate-800/60'
      }`}
    >
      {b.label}
    </span>
  )
}

/** Ligne : libellé (info-bulle = explication simple), #instance, valeur cliquable. */
function GRow({
  label,
  labelKey,
  value,
  step,
  req,
  certainty,
  schema,
  strong = false,
}: {
  label?: string
  labelKey?: string
  value: ReactNode
  step?: number | null
  req?: InspectRequest
  certainty?: Certainty
  schema: string
  strong?: boolean
}) {
  const meta = labelKey ? GEO_LABELS[labelKey] : undefined
  const text = label ?? meta?.label ?? ''
  const absent = value === null || value === undefined || value === ''
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span
        className={`text-gray-500 flex-shrink-0 ${meta ? 'cursor-help decoration-dotted underline-offset-2 hover:underline' : ''}`}
        title={meta ? `${meta.ifc}\n${meta.simple}` : undefined}
      >
        {text}
        {step !== undefined && step !== null && <span className="ml-1 font-mono text-[9px] text-gray-600">#{step}</span>}
        {certainty && <CertaintyBadge c={certainty} schema={schema} />}
      </span>
      {absent ? (
        <span className="text-gray-600 italic text-right">absent du fichier</span>
      ) : req ? (
        <IfcLink request={req} className={`text-right break-words min-w-0 tabular-nums ${strong ? 'text-white font-semibold' : 'text-gray-200'}`}>
          {value}
        </IfcLink>
      ) : (
        <span className={`text-right break-words min-w-0 tabular-nums ${strong ? 'text-white font-semibold' : 'text-gray-200'}`}>{value}</span>
      )}
    </div>
  )
}

function Block({
  title,
  source,
  help,
  children,
  defaultOpen = true,
}: {
  title: string
  source?: string
  help?: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [showHelp, setShowHelp] = useState(false)
  return (
    <div className="border border-gray-800 bg-gray-900/40">
      <div className="flex items-start gap-1 px-2.5 py-1.5">
        <button type="button" onClick={() => setOpen(!open)} className="flex-1 min-w-0 text-left">
          <span className="block text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</span>
          {source && <span className="block text-[10px] font-mono text-gray-600 break-words">{source}</span>}
        </button>
        {help && (
          <button
            type="button"
            onClick={() => setShowHelp(!showHelp)}
            title="Explication détaillée"
            className={`text-[11px] leading-none px-1 ${showHelp ? 'text-blue-300' : 'text-gray-600 hover:text-gray-300'}`}
          >
            ⓘ
          </button>
        )}
        <button type="button" onClick={() => setOpen(!open)} className="text-gray-700 text-xs">{open ? '▲' : '▼'}</button>
      </div>
      {showHelp && help && <p className="mx-2.5 mb-1.5 px-2 py-1 text-[10px] leading-snug text-gray-400 bg-gray-950/60 border-l-2 border-blue-800">{help}</p>}
      {open && <div className="px-2.5 pb-2 pt-0.5 text-xs space-y-0.5">{children}</div>}
    </div>
  )
}

const geo = (key: string): InspectRequest => ({ kind: 'geo', key })

/* ---------- Panneau ---------- */

/**
 * Affichage du géoréférencement selon la spécification : statut, valeur
 * principale (arbre de décision §3), puis toutes les autres sources en
 * secondaire, jamais cachées, avec nom IFC, instance STEP, explications et
 * niveau de certitude.
 */
export function GeorefPanel({ g }: { g: GeoAnalysis }) {
  const toM = g.lengthUnit.toMetre
  const mc = g.mapConversion
  const site = g.sites[0] ?? null
  const pl = site?.placement ?? null
  const st = STATUS_INFO[g.status]
  const tone = {
    ok: 'border-emerald-700 bg-emerald-950/30 text-emerald-300',
    mid: 'border-amber-700 bg-amber-950/30 text-amber-300',
    low: 'border-orange-800 bg-orange-950/30 text-orange-300',
    none: 'border-gray-700 bg-gray-900 text-gray-400',
  }[st.tone]
  const S = g.schema
  const warns = g.checks.filter((c) => c.severity === 'warn').length
  const crsName = g.crs?.name ?? (g.crs?.wkt ? 'carte (WKT)' : null)

  /* Valeur principale */
  let primary: ReactNode
  if (g.primarySource === 'MAP_CONVERSION' && mc) {
    primary = (
      <>
        <p className="text-[11px] text-gray-300 leading-snug pb-1">
          L’origine du projet est placée sur la carte {crsName ?? 'inconnue'}{mc.rotationDeg !== null ? `, avec une rotation de ${fmtAng(mc.rotationDeg)}` : ''}.
        </p>
        <GRow schema={S} labelKey="map.eastings" step={mc.stepId} value={fmtLen(mc.eastings, toM)} req={geo('mc.eastings')} strong />
        <GRow schema={S} labelKey="map.northings" step={mc.stepId} value={fmtLen(mc.northings, toM)} req={geo('mc.northings')} strong />
        <GRow schema={S} labelKey="map.height" step={mc.stepId} value={fmtLen(mc.orthogonalHeight, toM)} req={geo('mc.orthogonalHeight')} strong />
        <GRow schema={S} labelKey="map.rotation" step={mc.stepId}
          value={mc.rotationDeg !== null ? fmtAng(mc.rotationDeg) : mc.rotationMissing ? 'non renseignée' : 'direction invalide'}
          req={geo('mc.rotation')} />
        <GRow schema={S} labelKey="map.scale" step={mc.stepId}
          value={mc.scale === null ? '1 (valeur par défaut)' : String(mc.scale)} req={geo('mc.scale')} />
        {mc.factors && (
          <GRow schema={S} label="FactorX / Y / Z" step={mc.stepId}
            value={[mc.factors.x, mc.factors.y, mc.factors.z].map((v) => v ?? '—').join(' / ')} req={geo('mc.scale')} />
        )}
        <GRow schema={S} labelKey="crs.name" step={g.crs?.stepId} value={crsName} req={geo('crs.name')} />
      </>
    )
  } else if (g.primarySource === 'SITE_PLACEMENT' && pl) {
    primary = (
      <>
        <p className="text-[11px] text-gray-300 leading-snug pb-1">
          {g.status === 'GEOREF_IDENTITE'
            ? `Position du terrain, à lire directement sur la carte ${crsName}.`
            : 'Position du terrain dans le repère du projet. Ces valeurs ne sont rattachées à aucune carte.'}
        </p>
        <GRow schema={S} label="X" step={pl.pointStepId} value={fmtLen(pl.x, toM)} req={geo('site.position')} strong />
        <GRow schema={S} label="Y" step={pl.pointStepId} value={fmtLen(pl.y, toM)} req={geo('site.position')} strong />
        <GRow schema={S} label="Z" step={pl.pointStepId} value={fmtLen(pl.z, toM)} req={geo('site.position')} strong />
        <GRow schema={S} labelKey="site.rotation" step={pl.pointStepId} value={fmtAng(pl.rotationDeg)} req={geo('site.orientation')} />
        {g.status === 'GEOREF_IDENTITE' && <GRow schema={S} labelKey="crs.name" step={g.crs?.stepId} value={crsName} req={geo('crs.name')} />}
      </>
    )
  } else if (g.primarySource === 'SITE_LATLONG' && site) {
    primary = (
      <>
        <p className="text-[11px] text-gray-300 leading-snug pb-1">Position GPS indicative du terrain : elle situe le projet, sans le positionner précisément.</p>
        <GRow schema={S} label="Latitude" step={site.stepId} value={site.refLatitude?.dms} req={geo('geo.latitude')} strong />
        <GRow schema={S} label="Longitude" step={site.stepId} value={site.refLongitude?.dms} req={geo('geo.longitude')} strong />
      </>
    )
  } else {
    primary = <p className="text-gray-600 italic py-0.5">Aucune source de position dans le fichier.</p>
  }

  return (
    <>
      {/* Statut + valeur principale */}
      <div className="border border-amber-700/70 bg-amber-950/10">
        <div className="px-2.5 pt-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Géoréférencement</p>
          <div className="flex flex-wrap items-center gap-1 mt-1">
            <span className={`px-1.5 py-0.5 text-[11px] font-medium rounded border ${tone}`}>{st.label}</span>
            <CertaintyBadge c={g.statusCertainty} schema={S} />
            <span className="text-[10px] font-mono text-gray-600">{g.fileSchemaRaw ?? g.schema}</span>
          </div>
          <p className="text-[10px] text-gray-400 leading-snug mt-1">{S === 'IFC2X3' ? st.text : st.text.replace(' C’est le cas normal en IFC 2x3.', '')}</p>
        </div>
        <div className="px-2.5 pb-2 pt-1.5 text-xs space-y-0.5">
          <p className="text-[10px] uppercase tracking-wider text-amber-400/80">Valeur principale</p>
          {primary}
          {toM !== 1 && (
            <p className="text-[10px] text-gray-500 pt-0.5">
              Converti en mètres ; unité du fichier : {g.lengthUnit.prefix ?? ''}{g.lengthUnit.name}.
            </p>
          )}
        </div>
      </div>

      {/* Carte (CRS) */}
      {g.crs ? (
        <Block title="Carte (CRS)" source={`${g.crs.type} #${g.crs.stepId}`} help={GEO_LABELS['crs.name'].detail}>
          <GRow schema={S} label="Nom" step={g.crs.stepId} value={g.crs.name} req={geo('crs.name')} />
          {g.crs.epsgCode !== null && (
            <div className="flex items-baseline justify-between gap-2 py-0.5">
              <span className="text-gray-500">Registre EPSG<CertaintyBadge c="HYPOTHESE" schema={S} /></span>
              <a href={`https://epsg.io/${g.crs.epsgCode}`} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 underline">
                epsg.io/{g.crs.epsgCode} ↗
              </a>
            </div>
          )}
          <GRow schema={S} label="Description" step={g.crs.stepId} value={g.crs.description} req={geo('crs.description')} />
          <GRow schema={S} label="Datum géodésique" step={g.crs.stepId} value={g.crs.geodeticDatum} req={geo('crs.geodeticDatum')} />
          <GRow schema={S} label="Datum vertical" step={g.crs.stepId} value={g.crs.verticalDatum} req={geo('crs.verticalDatum')} />
          <GRow schema={S} label="Projection" step={g.crs.stepId} value={g.crs.mapProjection} req={geo('crs.mapProjection')} />
          <GRow schema={S} label="Zone" step={g.crs.stepId} value={g.crs.mapZone} req={geo('crs.mapZone')} />
          <GRow schema={S} label="Unité" step={g.crs.stepId} value={g.crs.mapUnit} req={geo('crs.mapUnit')} />
          {g.crs.wkt && <GRow schema={S} label="WKT" value={`${g.crs.wkt}…`} />}
        </Block>
      ) : (
        <Block title="Carte (CRS)" source="IfcProjectedCRS" defaultOpen>
          <p className="text-gray-600 italic py-0.5">
            {S === 'IFC2X3' ? 'Aucune carte possible en IFC2x3 (IfcProjectedCRS introduit en IFC4).' : 'Aucune carte déclarée.'}
          </p>
        </Block>
      )}

      {/* Conversion — secondaire quand elle n'est pas la valeur principale */}
      {g.primarySource !== 'MAP_CONVERSION' && (
        <Block
          title="Conversion vers la carte"
          source={mc ? `${mc.type} #${mc.stepId}` : 'IfcMapConversion'}
          help="Voici où le point 0, 0, 0 de la maquette tombe sur la carte, à quelle altitude, et de combien la maquette est tournée. Ordre : échelle, rotation, translation."
          defaultOpen={!!mc}
        >
          {mc ? (
            <>
              {mc.isZero && <p className="text-[10px] text-gray-400 pb-0.5">Conversion déclarée, valeurs à zéro.</p>}
              <GRow schema={S} labelKey="map.eastings" step={mc.stepId} value={fmtLen(mc.eastings, toM)} req={geo('mc.eastings')} />
              <GRow schema={S} labelKey="map.northings" step={mc.stepId} value={fmtLen(mc.northings, toM)} req={geo('mc.northings')} />
              <GRow schema={S} labelKey="map.height" step={mc.stepId} value={fmtLen(mc.orthogonalHeight, toM)} req={geo('mc.orthogonalHeight')} />
              <GRow schema={S} labelKey="map.rotation" step={mc.stepId} value={mc.rotationDeg !== null ? fmtAng(mc.rotationDeg) : 'non renseignée'} req={geo('mc.rotation')} />
              <GRow schema={S} labelKey="map.scale" step={mc.stepId} value={mc.scale === null ? '1 (valeur par défaut)' : String(mc.scale)} req={geo('mc.scale')} />
            </>
          ) : (
            <p className="text-gray-600 italic py-0.5">
              {S === 'IFC2X3' ? 'IfcMapConversion n’existe pas en IFC2x3 (introduite en IFC4).' : 'Absente du fichier.'}
            </p>
          )}
        </Block>
      )}

      {/* Position du terrain — secondaire quand elle n'est pas la valeur principale */}
      {g.primarySource !== 'SITE_PLACEMENT' && (
        <Block title="Position du terrain dans le projet" source={pl ? `IfcSite #${site!.stepId} → IfcCartesianPoint #${pl.pointStepId}` : 'IfcSite.ObjectPlacement'} help={GEO_LABELS['site.xyz'].detail}>
          {pl ? (
            <>
              <GRow schema={S} label="X" step={pl.pointStepId} value={fmtLen(pl.x, toM)} req={geo('site.position')} certainty={pl.certainty} />
              <GRow schema={S} label="Y" step={pl.pointStepId} value={fmtLen(pl.y, toM)} req={geo('site.position')} />
              <GRow schema={S} label="Z" step={pl.pointStepId} value={fmtLen(pl.z, toM)} req={geo('site.position')} />
              <GRow schema={S} labelKey="site.rotation" step={pl.pointStepId} value={fmtAng(pl.rotationDeg)} req={geo('site.orientation')} />
              {pl.isZero && <p className="text-[10px] text-gray-500 pt-0.5">Le terrain est à l’origine du projet : aucune coordonnée de chantier.</p>}
            </>
          ) : (
            <p className="text-gray-600 italic py-0.5">{site ? 'Le terrain n’a pas de placement.' : 'Aucun IfcSite.'}</p>
          )}
        </Block>
      )}

      {/* Position carte calculée (§7.2) */}
      {site?.mapPosition && g.status !== 'GEOREF_IDENTITE' && (
        <Block title="Position carte du terrain" source="calculée (§7.2) — pas écrite dans le fichier" help={GEO_LABELS['site.mapPosition'].detail}>
          <GRow schema={S} label="E" value={fmtLen(site.mapPosition.e, toM)} req={geo('site.result')} certainty="VERIFIE" />
          <GRow schema={S} label="N" value={fmtLen(site.mapPosition.n, toM)} req={geo('site.result')} />
          <GRow schema={S} label="H" value={fmtLen(site.mapPosition.h, toM)} req={geo('site.result')} />
          {crsName && <p className="text-[10px] text-gray-500 pt-0.5">Sur la carte {crsName}.</p>}
        </Block>
      )}

      {/* GPS indicatif (§4.6) — jamais principal sauf GPS_SEUL */}
      {g.primarySource !== 'SITE_LATLONG' && (
        <Block title="Position GPS indicative" source={site ? `IfcSite #${site.stepId} — RefLatitude, RefLongitude, RefElevation` : 'IfcSite'} help={GEO_LABELS['site.latlong'].detail}>
          <GRow schema={S} label="Latitude" step={site?.stepId} value={site?.refLatitude?.dms} req={geo('geo.latitude')} />
          <GRow schema={S} label="Longitude" step={site?.stepId} value={site?.refLongitude?.dms} req={geo('geo.longitude')} />
          {site?.refLatitude && site.refLongitude && (
            <GRow schema={S} label="Décimal" value={`${dec6(site.refLatitude.decimal)} ; ${dec6(site.refLongitude.decimal)}`} req={geo('geo.latitude')} />
          )}
          <GRow schema={S} labelKey="site.elevation" step={site?.stepId} value={site?.refElevation !== null && site?.refElevation !== undefined ? `${fmtLen(site.refElevation, toM)} m` : null} req={geo('geo.elevation')} />
        </Block>
      )}
      {g.primarySource === 'SITE_LATLONG' && site && (
        <Block title="Altitude et décimal" source={`IfcSite #${site.stepId}`} help={GEO_LABELS['site.latlong'].detail}>
          {site.refLatitude && site.refLongitude && (
            <GRow schema={S} label="Décimal" value={`${dec6(site.refLatitude.decimal)} ; ${dec6(site.refLongitude.decimal)}`} req={geo('geo.latitude')} />
          )}
          <GRow schema={S} labelKey="site.elevation" step={site.stepId} value={site.refElevation !== null ? `${fmtLen(site.refElevation, toM)} m` : null} req={geo('geo.elevation')} />
        </Block>
      )}

      {/* Nord et repère du projet (fiche 4.7) */}
      <Block title="Nord et repère du projet" source={g.context ? `IfcGeometricRepresentationContext #${g.context.stepId}` : undefined} help={GEO_LABELS['ctx.trueNorth'].detail}>
        {g.context ? (
          <>
            <GRow schema={S} labelKey="ctx.trueNorth" step={g.context.trueNorth.stepId}
              value={g.context.trueNorth.isDefault ? 'axe +Y (par défaut)' : fmtAng(g.context.trueNorth.angleDeg)} req={geo('trueNorth')} />
            <GRow schema={S} label="Origine du repère" step={g.context.stepId}
              value={g.context.wcs.isIdentity ? '0 ; 0 ; 0, sans rotation' : `${fmtLen(g.context.wcs.x, toM)} ; ${fmtLen(g.context.wcs.y, toM)} ; ${fmtLen(g.context.wcs.z, toM)}`}
              req={geo('ctx.wcs')} />
          </>
        ) : (
          <p className="text-gray-600 italic py-0.5">Aucun contexte géométrique 3D.</p>
        )}
      </Block>

      {/* Contrôles et avertissements (§5) */}
      <Block title={`Contrôles — ${warns} alerte${warns > 1 ? 's' : ''}`}>
        {g.checks.map((c, i) => (
          <div key={i} className="flex gap-1.5 py-0.5 leading-snug" title={c.code}>
            <span className={c.severity === 'warn' ? 'text-amber-400' : c.severity === 'ok' ? 'text-emerald-400' : 'text-gray-500'}>
              {c.severity === 'warn' ? '⚠' : c.severity === 'ok' ? '✓' : 'ℹ'}
            </span>
            <span className="text-gray-300 min-w-0">
              {c.key ? <IfcLink request={geo(c.key)}>{c.text}</IfcLink> : c.text}
              <CertaintyBadge c={c.certainty} schema={S} />
            </span>
          </div>
        ))}
        {g.checks.length === 0 && <p className="text-gray-600 italic">Aucun contrôle déclenché.</p>}
      </Block>
    </>
  )
}
