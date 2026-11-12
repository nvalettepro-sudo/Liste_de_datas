/**
 * Analyse du géoréférencement d'un fichier IFC, selon la spécification
 * « Géoréférencement IFC — spécification de lecture et d'affichage »
 * (12/11/2026). Les numéros de section (§) et de cas renvoient à ce document.
 *
 * Règles d'or (§0) : afficher ce qui est écrit dans le fichier sans le
 * corriger, ne jamais inventer une valeur absente, toujours citer l'instance
 * STEP, séparer repère du projet et carte, ne jamais faire de RefLatitude /
 * RefLongitude / RefElevation la valeur principale.
 */
import * as WebIFC from 'web-ifc'
import type { IfcReader, Rec } from './ifcReader'
import { decodeStepString, headerArgs, parseStepNumber, parseStepRef, parseStepString } from './step'
import type {
  Certainty,
  GeoAnalysis,
  GeoAngle,
  GeoCheck,
  GeoCrs,
  GeoMapConversion,
  GeoSite,
  GeoStatus,
  XYZ,
} from './types'

/* ---------- Tolérances (§7.5) ---------- */

/** Longueur considérée comme nulle, en mètres. */
export const LENGTH_ZERO_M = 1e-6
/** Composante de direction considérée comme nulle. */
export const DIRECTION_ZERO = 1e-9
/** Écart nord / rotation au-delà duquel on avertit (§7.4) — [HYPOTHÈSE] seuil choisi. */
export const NORTH_TOLERANCE_DEG = 1
/** Au-delà, des coordonnées « ressemblent » à du projeté (piège 3) — [HYPOTHÈSE] seuil arbitraire. */
export const PROJECTED_LOOKING_M = 100_000

/* ---------- Petits utilitaires ---------- */

function unwrap(v: unknown): unknown {
  let x = v
  while (x && typeof x === 'object' && !Array.isArray(x) && 'value' in (x as Rec)) x = (x as Rec).value
  return x
}
function num(v: unknown): number | null {
  const x = unwrap(v)
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}
function str(v: unknown): string | null {
  const x = unwrap(v)
  if (x === null || x === undefined || x === '') return null
  return decodeStepString(String(x))
}
function ref(v: unknown): number | null {
  const r = v as Rec | undefined
  return r && typeof r.value === 'number' ? (r.value as number) : null
}
function refs(v: unknown): number[] {
  if (!Array.isArray(v)) return ref(v) !== null ? [ref(v)!] : []
  return v.map(ref).filter((x): x is number => x !== null)
}
function list(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v
  const x = (v as Rec | undefined)?.value
  return Array.isArray(x) ? x : null
}
const deg = (rad: number) => (rad * 180) / Math.PI
const fr = (v: number, d: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })
/** Angle en degrés ramené dans [0, 360[. */
export const norm360 = (d: number) => {
  const r = ((d % 360) + 360) % 360
  return Math.abs(r - 360) < 1e-9 ? 0 : r
}

type Vec3 = [number, number, number]
interface Frame { o: Vec3; x: Vec3; y: Vec3; z: Vec3 }
const vnorm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

function coords(r: IfcReader, id: number | null): Vec3 | null {
  const l = r.line(id)
  if (!l) return null
  const arr = list(l.Coordinates ?? l.DirectionRatios)
  if (!arr) return null
  const n = arr.map((v) => num(v) ?? 0)
  return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0]
}

/** IfcAxis2Placement3D → repère (Z = Axis, X = RefDirection orthogonalisée). */
function frameOf(r: IfcReader, axisId: number | null): Frame {
  const ax = r.line(axisId)
  const o = (ax && coords(r, ref(ax.Location))) ?? [0, 0, 0]
  const z = vnorm((ax && coords(r, ref(ax.Axis))) ?? [0, 0, 1])
  let x = (ax && coords(r, ref(ax.RefDirection))) ?? ([1, 0, 0] as Vec3)
  const d = dot(x, z)
  x = vnorm([x[0] - d * z[0], x[1] - d * z[1], x[2] - d * z[2]])
  return { o, x, y: cross(z, x), z }
}

function compose(parent: Frame, local: Frame): Frame {
  const ap = (v: Vec3): Vec3 => [
    parent.x[0] * v[0] + parent.y[0] * v[1] + parent.z[0] * v[2],
    parent.x[1] * v[0] + parent.y[1] * v[1] + parent.z[1] * v[2],
    parent.x[2] * v[0] + parent.y[2] * v[1] + parent.z[2] * v[2],
  ]
  const po = ap(local.o)
  return { o: [parent.o[0] + po[0], parent.o[1] + po[1], parent.o[2] + po[2]], x: ap(local.x), y: ap(local.y), z: ap(local.z) }
}

/* ---------- Latitude / longitude (§7.3, fiche 4.6) ---------- */

function angleOf(raw: unknown, positive: string, negative: string): GeoAngle | null {
  const arr = list(raw)
  if (!arr || arr.length < 3) return null
  const parts = arr.map((v) => num(v) ?? 0)
  const [d, m, s, mu = 0] = parts // cas 21 : 3 éléments → millionièmes = 0
  const decimal = d + m / 60 + (s + mu / 1e6) / 3600
  const sec = (Math.abs(s) + Math.abs(mu) / 1e6).toFixed(6).replace(/\.?0+$/, '').replace('.', ',')
  const hemi = decimal < 0 ? negative : positive
  return { raw: parts, decimal, dms: `${Math.abs(d)}° ${Math.abs(m)}' ${sec}" ${hemi}` }
}

/* ---------- Unité de longueur (cas 24) ---------- */

const SI_PREFIX: Record<string, number> = {
  EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 1e1,
  DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9, PICO: 1e-12, FEMTO: 1e-15, ATTO: 1e-18,
}

function lengthUnitOf(r: IfcReader, project: Rec | null): GeoAnalysis['lengthUnit'] {
  const ua = r.line(ref(project?.UnitsInContext))
  const candidates = ua ? refs(ua.Units) : r.ids(WebIFC.IFCSIUNIT)
  for (const id of candidates) {
    const u = r.line(id)
    if (!u || str(u.UnitType) !== 'LENGTHUNIT') continue
    const name = str(u.Name) ?? '?'
    const prefix = str(u.Prefix)
    if (u.ConversionFactor !== undefined) {
      const mwu = r.line(ref(u.ConversionFactor))
      const v = num(mwu?.ValueComponent) ?? 1
      const base = r.line(ref(mwu?.UnitComponent))
      const bp = str(base?.Prefix)
      return { name, prefix: null, toMetre: v * (bp ? SI_PREFIX[bp] ?? 1 : 1), stepId: id }
    }
    return { name, prefix, toMetre: prefix ? SI_PREFIX[prefix] ?? 1 : 1, stepId: id }
  }
  return { name: 'METRE', prefix: null, toMetre: 1, stepId: null }
}

/* ---------- Schéma (piège 11) ---------- */

export function normalizeSchema(raw: string | null): string {
  const s = (raw ?? '').toUpperCase()
  if (s.startsWith('IFC4X3')) return 'IFC4X3'
  if (s.startsWith('IFC4')) return 'IFC4'
  if (s.startsWith('IFC2X3')) return 'IFC2X3'
  return s || 'IFC2X3'
}

/* ---------- Analyse ---------- */

export function analyzeGeoreference(r: IfcReader): GeoAnalysis {
  const checks: GeoCheck[] = []
  const add = (code: string, severity: GeoCheck['severity'], text: string, certainty: Certainty, key?: string) =>
    checks.push({ code, severity, text, certainty, key })

  // En-tête
  const fileSchemaRaw = parseStepString(headerArgs(r.header, 'FILE_SCHEMA')?.[0]?.replace(/^\(|\)$/g, ''))
  const schema = normalizeSchema(fileSchemaRaw)
  const fileName = headerArgs(r.header, 'FILE_NAME')
  const descr = headerArgs(r.header, 'FILE_DESCRIPTION')?.[0] ?? ''
  const cb = descr.match(/CoordinateBase\s*:\s*([^,\]']+)/i)
  const coordinateBase = cb ? decodeStepString(cb[1].trim()) : null

  // Projet, application
  const projectId = r.ids(WebIFC.IFCPROJECT)[0] ?? null
  const project = r.line(projectId)
  const appIds = r.ids(WebIFC.IFCAPPLICATION)
  const app = r.line(appIds[0])
  const authoringTool = str(app?.ApplicationFullName) ?? parseStepString(fileName?.[5]) ?? null
  const lengthUnit = lengthUnitOf(r, project)
  const toM = lengthUnit.toMetre
  const isZeroLen = (v: number | null) => v === null || Math.abs(v * toM) < LENGTH_ZERO_M

  if (Math.abs(toM - 1) > 1e-12) {
    add('CASE_24_LENGTH_UNIT', 'info',
      `Unité de longueur du fichier : ${lengthUnit.prefix ? `${lengthUnit.prefix} ` : ''}${lengthUnit.name} (×${toM} m). Les valeurs sont converties en mètres pour l'affichage ; la valeur brute reste dans le code.`,
      'STANDARD')
  }

  /* --- Contexte 3D 'Model' (fiche 4.7) --- */
  const ctxIds = project ? refs(project.RepresentationContexts) : r.ids(WebIFC.IFCGEOMETRICREPRESENTATIONCONTEXT)
  const allCtx = ctxIds.map((id) => ({ id, l: r.line(id) })).filter((c) => c.l && c.l.CoordinateSpaceDimension !== undefined)
  const model3d =
    allCtx.find((c) => str(c.l!.ContextType) === 'Model' && num(c.l!.CoordinateSpaceDimension) === 3) ??
    allCtx.find((c) => num(c.l!.CoordinateSpaceDimension) === 3) ??
    allCtx[0] ??
    null
  let context: GeoAnalysis['context'] = null
  if (model3d) {
    const wcsF = frameOf(r, ref(model3d.l!.WorldCoordinateSystem))
    const wcsIdentity =
      wcsF.o.every((v) => Math.abs(v * toM) < LENGTH_ZERO_M) &&
      Math.abs(wcsF.x[0] - 1) < DIRECTION_ZERO && Math.abs(wcsF.z[2] - 1) < DIRECTION_ZERO
    const tnId = ref(model3d.l!.TrueNorth)
    const tn = coords(r, tnId)
    const tx = tn && Math.abs(tn[0]) >= DIRECTION_ZERO ? tn[0] : 0
    const ty = tn && Math.abs(tn[1]) >= DIRECTION_ZERO ? tn[1] : tn ? 0 : 1
    context = {
      stepId: model3d.id,
      dim: num(model3d.l!.CoordinateSpaceDimension),
      wcs: { x: wcsF.o[0], y: wcsF.o[1], z: wcsF.o[2], isIdentity: wcsIdentity },
      trueNorth: { x: tn ? tn[0] : 0, y: tn ? tn[1] : 1, stepId: tnId, angleDeg: norm360(deg(Math.atan2(-tx, ty))), isDefault: !tn },
    }
    if (!tn) add('CASE_22_TRUENORTH_DEFAULT', 'info', 'TrueNorth absent : le nord est l’axe +Y du projet (valeur par défaut).', 'STANDARD', 'trueNorth')
    if (!wcsIdentity) {
      add('CASE_23_WCS_OFFSET', 'warn',
        `Repère du projet (WorldCoordinateSystem #${ref(model3d.l!.WorldCoordinateSystem)}) décalé ou tourné : cas non testé, pas de calcul de position carte.`,
        'HYPOTHESE')
    }
  }

  /* --- Conversions (fiches 4.1, 4.3, 4.4) --- */
  const ctxDim = (id: number | null) => (id === null ? null : num(r.line(id)?.CoordinateSpaceDimension))
  const buildConv = (
    stepId: number,
    type: GeoMapConversion['type'],
    src: number | null,
    e: number | null, n: number | null, h: number | null,
    xa: number | null, xo: number | null, sc: number | null,
    factors: GeoMapConversion['factors']
  ): GeoMapConversion => {
    const rotationMissing = xa === null && xo === null
    const xaEff = xa ?? (rotationMissing ? 1 : null)
    const xoEff = xo ?? (rotationMissing ? 0 : null)
    const rotationValid =
      xaEff !== null && xoEff !== null && !(Math.abs(xaEff) < DIRECTION_ZERO && Math.abs(xoEff) < DIRECTION_ZERO)
    const rotationDeg = rotationValid ? norm360(deg(Math.atan2(xoEff!, xaEff!))) : null
    const noRotation = rotationValid && Math.abs(Math.atan2(xoEff!, xaEff!)) < DIRECTION_ZERO
    return {
      stepId, type,
      sourceContextStepId: src,
      sourceContextDim: ctxDim(src),
      eastings: e, northings: n, orthogonalHeight: h,
      xAxisAbscissa: xa, xAxisOrdinate: xo,
      scale: sc, scaleEffective: sc ?? 1,
      factors,
      rotationDeg, rotationMissing, rotationValid,
      isZero: isZeroLen(e) && isZeroLen(n) && isZeroLen(h) && (noRotation || rotationMissing),
      certainty: 'STANDARD',
    }
  }

  const convs: GeoMapConversion[] = []
  for (const id of r.ids(WebIFC.IFCMAPCONVERSION)) {
    const l = r.line(id)!
    convs.push(buildConv(id, 'IfcMapConversion', ref(l.SourceCRS), num(l.Eastings), num(l.Northings), num(l.OrthogonalHeight),
      num(l.XAxisAbscissa), num(l.XAxisOrdinate), num(l.Scale), null))
  }
  const targetOf = new Map<number, number | null>()
  for (const id of r.ids(WebIFC.IFCMAPCONVERSION)) targetOf.set(id, ref(r.line(id)?.TargetCRS))

  // Entités IFC4.3 que cette version de web-ifc ne décode pas : lecture du texte brut.
  const raw = schema === 'IFC4X3'
    ? r.rawScan(['IFCMAPCONVERSIONSCALED', 'IFCRIGIDOPERATION', 'IFCGEOGRAPHICCRS', 'IFCWELLKNOWNTEXT'])
    : []
  for (const x of raw.filter((x) => x.type === 'IFCMAPCONVERSIONSCALED')) {
    const a = x.args
    convs.push(buildConv(x.id, 'IfcMapConversionScaled', parseStepRef(a[0]), parseStepNumber(a[2]), parseStepNumber(a[3]),
      parseStepNumber(a[4]), parseStepNumber(a[5]), parseStepNumber(a[6]), parseStepNumber(a[7]),
      { x: parseStepNumber(a[8]), y: parseStepNumber(a[9]), z: parseStepNumber(a[10]) }))
    targetOf.set(x.id, parseStepRef(a[1]))
    add('CASE_19_SCALED', 'info', `IfcMapConversionScaled #${x.id} : facteurs par axe affichés, calcul de position carte non pris en charge.`, 'STANDARD', 'mc.scale')
  }
  for (const x of raw.filter((x) => x.type === 'IFCRIGIDOPERATION')) {
    const a = x.args
    add('CASE_20_RIGID', 'info',
      `IfcRigidOperation #${x.id} : FirstCoordinate ${a[2]?.trim()}, SecondCoordinate ${a[3]?.trim()}, Height ${a[4]?.trim()} (valeurs brutes).`,
      'STANDARD')
  }

  // Choix de la conversion principale (cas 8 et 9).
  const model3dId = model3d?.id ?? null
  let mapConversion =
    convs.find((c) => c.sourceContextStepId === model3dId) ??
    convs.find((c) => c.sourceContextDim === 3) ??
    convs.find((c) => c.sourceContextDim !== null) ??
    convs[0] ??
    null
  if (mapConversion && mapConversion.sourceContextDim === 2) {
    add('CASE_09_CONVERSION_2D_ONLY', 'warn', `Conversion #${mapConversion.stepId} définie pour le plan 2D seulement.`, 'HYPOTHESE', 'mc.eastings')
  }
  const otherMapConversions = convs.filter((c) => c !== mapConversion)
  if (otherMapConversions.length) {
    const differ = otherMapConversions.some(
      (c) => c.eastings !== mapConversion!.eastings || c.northings !== mapConversion!.northings ||
        c.orthogonalHeight !== mapConversion!.orthogonalHeight || c.rotationDeg !== mapConversion!.rotationDeg
    )
    add('CASE_08_MULTIPLE_MAP_CONVERSIONS', differ ? 'warn' : 'info',
      `${convs.length} conversions dans le fichier ; principale : #${mapConversion!.stepId} (contexte 3D 'Model').${differ ? ' Leurs valeurs diffèrent.' : ''}`,
      'HYPOTHESE', 'mc.eastings')
  }

  /* --- CRS (fiche 4.2) --- */
  const wkts = raw.filter((x) => x.type === 'IFCWELLKNOWNTEXT')
  const crsOf = (id: number | null): GeoCrs | null => {
    if (id === null) return null
    const l = r.line(id)
    const rawGeo = raw.find((x) => x.id === id)
    if (!l && !rawGeo) return null
    const name = l ? str(l.Name) : parseStepString(rawGeo!.args[0])
    const w = wkts.find((x) => parseStepRef(x.args[1]) === id)
    const unit = r.line(ref(l?.MapUnit))
    const m = name?.match(/^EPSG\s*:\s*(\d+)$/i)
    return {
      stepId: id,
      type: l ? r.typeName(id) ?? 'IfcProjectedCRS' : 'IfcGeographicCRS',
      name,
      epsgCode: m ? Number(m[1]) : null,
      description: l ? str(l.Description) : parseStepString(rawGeo!.args[1]),
      geodeticDatum: l ? str(l.GeodeticDatum) : parseStepString(rawGeo!.args[2]),
      verticalDatum: l ? str(l.VerticalDatum) : null,
      mapProjection: l ? str(l.MapProjection) : null,
      mapZone: l ? str(l.MapZone) : null,
      mapUnit: unit ? `${str(unit.Prefix) ?? ''}${str(unit.Name) ?? ''}` || null : null,
      wkt: w ? (parseStepString(w.args[0]) ?? '').slice(0, 160) : null,
    }
  }
  const crs = mapConversion ? crsOf(targetOf.get(mapConversion.stepId) ?? null) : null
  const crsReadable = !!crs && (!!crs.name || !!crs.wkt)
  if (crs && !crs.name) {
    add('CASE_07_CRS_NO_NAME', crs.wkt ? 'info' : 'warn',
      crs.wkt ? `CRS #${crs.stepId} sans Name : décrit par IfcWellKnownText.` : `CRS #${crs.stepId} sans Name ni IfcWellKnownText : fichier non conforme (règle NameOrWKT).`,
      'VERIFIE', 'crs.name')
  }
  const referenced = new Set([...targetOf.values()])
  for (const id of r.ids(WebIFC.IFCPROJECTEDCRS)) {
    if (!referenced.has(id)) {
      add('CASE_06_CRS_WITHOUT_CONVERSION', 'warn', `Carte déclarée (IfcProjectedCRS #${id}), mais aucune conversion vers elle.`, 'STANDARD', 'crs.name')
    }
  }
  for (const g of raw.filter((x) => x.type === 'IFCGEOGRAPHICCRS')) {
    add('IFC43_GEOGRAPHIC_CRS', 'info', `IfcGeographicCRS #${g.id} présent (${parseStepString(g.args[0]) ?? 'sans nom'}) : il ne peut pas être la cible d’une IfcMapConversion.`, 'VERIFIE')
  }

  if (mapConversion) {
    if (mapConversion.rotationMissing) {
      add('CASE_15_ROTATION_MISSING', 'info', 'Rotation non renseignée (XAxisAbscissa et XAxisOrdinate absents) : calcul sans rotation.', 'HYPOTHESE', 'mc.rotation')
    } else if (!mapConversion.rotationValid) {
      add('CASE_16_ROTATION_INVALID', 'warn', 'Direction de rotation invalide : pas de calcul de position carte.', 'HYPOTHESE', 'mc.rotation')
    }
    if (mapConversion.scale === null) {
      add('CASE_17_SCALE_DEFAULT', 'info', 'Scale absent : échelle 1 (valeur par défaut).', 'VERIFIE', 'mc.scale')
    } else if (Math.abs(mapConversion.scale - 1) > 1e-12) {
      add('CASE_18_SCALE_NOT_ONE', 'warn', `Échelle ${mapConversion.scale} : vérifier les unités du projet et de la carte.`, 'STANDARD', 'mc.scale')
    }
  }

  /* --- Sites (fiches 4.5, 4.6 ; cas 10 à 14) --- */
  const siteIds = r.ids(WebIFC.IFCSITE)
  let primarySiteId: number | null = null
  for (const relId of r.ids(WebIFC.IFCRELAGGREGATES)) {
    const rel = r.line(relId)
    if (!rel || ref(rel.RelatingObject) !== projectId) continue
    const hit = refs(rel.RelatedObjects).find((id) => siteIds.includes(id))
    if (hit !== undefined) { primarySiteId = hit; break }
  }
  primarySiteId ??= siteIds[0] ?? null

  const convUsable =
    !!mapConversion && mapConversion.rotationValid && !mapConversion.factors && (context?.wcs.isIdentity ?? true) &&
    mapConversion.sourceContextDim !== 2

  const sites: GeoSite[] = siteIds.map((id) => {
    const l = r.line(id)!
    let placement: GeoSite['placement'] = null
    const lpId = ref(l.ObjectPlacement)
    const lp = r.line(lpId)
    if (lp && lpId !== null) {
      const axId = ref(lp.RelativePlacement)
      const ax = r.line(axId)
      const ptId = ax ? ref(ax.Location) : null
      const ptType = ptId !== null ? r.typeName(ptId) : null
      let frame = frameOf(r, axId)
      let composed = false
      let parentId = ref(lp.PlacementRelTo)
      for (let depth = 0; parentId !== null && depth < 32; depth++) {
        const p = r.line(parentId)
        if (!p) break
        frame = compose(frameOf(r, ref(p.RelativePlacement)), frame)
        composed = true
        parentId = ref(p.PlacementRelTo)
      }
      const rd = ax ? coords(r, ref(ax.RefDirection)) : null
      const xdir = frame.x
      const rot = Math.abs(xdir[1]) < DIRECTION_ZERO && xdir[0] > 0 ? 0 : norm360(deg(Math.atan2(xdir[1], xdir[0])))
      placement = {
        localPlacementStepId: lpId,
        relativeToStepId: ref(lp.PlacementRelTo),
        pointStepId: ptId,
        pointType: ptType,
        x: frame.o[0], y: frame.o[1], z: frame.o[2],
        refDirection: rd ? { x: rd[0], y: rd[1], z: rd[2] } : null,
        rotationDeg: rot,
        isZero: frame.o.every((v) => Math.abs(v * toM) < LENGTH_ZERO_M) && rot === 0,
        composed,
        certainty: schema === 'IFC2X3' ? 'VERIFIE_2X3' : 'HYPOTHESE',
      }
      if (ptType && ptType !== 'IfcCartesianPoint') {
        add('CASE_14_POINT_TYPE', 'warn', `Location du site #${id} de type ${ptType} : type de point non pris en charge.`, 'VERIFIE', 'site.position')
      }
      if (composed) add('CASE_13_RELATIVE_PLACEMENT', 'warn', `Site #${id} placé relativement (PlacementRelTo) : placements parents composés.`, 'HYPOTHESE', 'site.position')
    } else {
      add('CASE_12_SITE_NO_PLACEMENT', 'warn', `Le terrain #${id} n’a pas de placement (ObjectPlacement absent).`, 'STANDARD')
    }
    const refLatitude = angleOf(l.RefLatitude, 'N', 'S')
    const refLongitude = angleOf(l.RefLongitude, 'E', 'O')
    let mapPosition: GeoSite['mapPosition'] = null
    if (placement && convUsable && mapConversion) {
      const t = ((mapConversion.rotationDeg ?? 0) * Math.PI) / 180
      const s = mapConversion.scaleEffective
      mapPosition = {
        e: s * (placement.x * Math.cos(t) - placement.y * Math.sin(t)) + (mapConversion.eastings ?? 0),
        n: s * (placement.x * Math.sin(t) + placement.y * Math.cos(t)) + (mapConversion.northings ?? 0),
        h: s * placement.z + (mapConversion.orthogonalHeight ?? 0),
      }
    }
    return {
      stepId: id,
      name: str(l.Name),
      isPrimary: id === primarySiteId,
      placement,
      refLatitude,
      refLongitude,
      refElevation: num(l.RefElevation),
      mapPosition,
    }
  })
  sites.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
  const site = sites[0] ?? null
  if (!site) add('CASE_11_NO_SITE', 'warn', 'Aucun IfcSite : pas de position de terrain.', 'STANDARD')
  if (sites.length > 1) {
    add('CASE_10_MULTIPLE_SITES', 'warn',
      `${sites.length} IfcSite ; principal : #${site!.stepId} (agrégé sous IfcProject). Autres : ${sites.slice(1).map((s) => `#${s.stepId}`).join(', ')}.`,
      'HYPOTHESE', 'site.position')
  }

  /* --- Arbre de décision (§3) --- */
  let status: GeoStatus
  let statusCertainty: Certainty
  let primarySource: GeoAnalysis['primarySource']
  const placementNonZero = !!site?.placement && !site.placement.isZero
  if (mapConversion && !mapConversion.isZero && mapConversion.rotationValid) {
    status = crsReadable ? 'GEOREF_COMPLET' : 'GEOREF_SANS_CRS'
    statusCertainty = 'STANDARD'
    primarySource = 'MAP_CONVERSION'
  } else if (mapConversion?.isZero && crsReadable && placementNonZero) {
    // Ajout à la spécification (point 2a) : conversion identité vers une carte connue.
    status = 'GEOREF_IDENTITE'
    statusCertainty = 'HYPOTHESE'
    primarySource = 'SITE_PLACEMENT'
  } else if (placementNonZero) {
    status = 'POSITION_LOCALE'
    statusCertainty = schema === 'IFC2X3' ? 'VERIFIE_2X3' : 'HYPOTHESE'
    primarySource = 'SITE_PLACEMENT'
  } else {
    // La position GPS (RefLatitude/RefLongitude) relève de la géolocalisation,
    // pas du géoréférencement : sans conversion ni position de terrain, le
    // fichier n'est pas géoréférencé, même s'il est géolocalisé.
    status = 'AUCUN'
    statusCertainty = 'STANDARD'
    primarySource = null
  }

  if (mapConversion?.isZero) {
    add('CASE_05_ZERO_CONVERSION', 'info',
      status === 'GEOREF_IDENTITE'
        ? `Conversion #${mapConversion.stepId} déclarée avec des valeurs à zéro (identité) : les coordonnées du terrain se lisent directement sur ${crs?.name ?? 'la carte'}.`
        : `Conversion #${mapConversion.stepId} déclarée, valeurs à zéro : non retenue comme valeur principale.`,
      'HYPOTHESE', 'mc.eastings')
  }
  if (!mapConversion && schema !== 'IFC2X3') {
    add('CASE_04_NO_CONVERSION', 'info', 'Aucune IfcMapConversion : on se rabat sur la position du terrain.', 'HYPOTHESE')
  }
  if (schema === 'IFC2X3') {
    add('SCHEMA_2X3', 'info', 'IFC2x3 : IfcMapConversion n’existe pas dans ce schéma (introduite en IFC4).', 'VERIFIE')
  }
  if (site?.placement?.isZero) {
    add('CASE_02_SITE_AT_ORIGIN', 'info', 'Le terrain est à l’origine du projet : aucune coordonnée de chantier.', 'HYPOTHESE', 'site.position')
  }
  if ((status === 'POSITION_LOCALE' || status === 'GEOREF_IDENTITE') && site?.placement &&
      (Math.abs(site.placement.x * toM) > PROJECTED_LOOKING_M || Math.abs(site.placement.y * toM) > PROJECTED_LOOKING_M)) {
    add('PIEGE_03_PROJECTED_LOOKING', 'info',
      status === 'POSITION_LOCALE'
        ? 'Ces valeurs ressemblent à des coordonnées projetées, mais aucune carte n’est déclarée.'
        : 'Les coordonnées de chantier sont portées par le placement du terrain, pas par IfcMapConversion.',
      'HYPOTHESE', 'site.position')
  }
  if (status === 'POSITION_LOCALE' && /archicad/i.test(authoringTool ?? '')) {
    add('PIEGE_01_ARCHICAD_SIGN', 'info', 'Archicad écrit les coordonnées du point de levé avec le signe inversé : la valeur affichée est celle du fichier, comme dans Solibri.', 'HYPOTHESE', 'site.position')
  }
  if (coordinateBase) {
    add('REVIT_COORDINATE_BASE', 'info', `Origine de l’export Revit : ${coordinateBase}.`, 'VERIFIE')
  }

  // §7.4 — cohérence nord / rotation (modulo 360).
  if (context && mapConversion?.rotationValid && !context.trueNorth.isDefault) {
    const sum = norm360(context.trueNorth.angleDeg + (mapConversion.rotationDeg ?? 0))
    const gap = Math.min(sum, 360 - sum)
    if (gap > NORTH_TOLERANCE_DEG) {
      add('NORTH_ROTATION_MISMATCH', 'warn', `Le nord du projet (${fr(context.trueNorth.angleDeg, 2)}°) et la rotation de la conversion (${fr(mapConversion.rotationDeg!, 2)}°) ne concordent pas (écart ${fr(gap, 2)}°).`, 'HYPOTHESE', 'trueNorth')
    } else {
      add('NORTH_ROTATION_CONSISTENT', 'ok', `Nord et rotation concordants (α + θ = ${fr(context.trueNorth.angleDeg + (mapConversion.rotationDeg ?? 0), 2)}°).`, 'HYPOTHESE', 'trueNorth')
    }
  }

  // Piège 4 — RefElevation n'est pas l'altitude du géoréférencement : information seulement.
  if (site?.refElevation !== null && site?.refElevation !== undefined) {
    const h = site.mapPosition?.h ?? site.placement?.z ?? null
    if (h !== null && Math.abs((site.refElevation - h) * toM) > 1e-3) {
      add('PIEGE_04_REFELEVATION', 'info',
        `RefElevation (${fr(site.refElevation * toM, 3)} m) diffère de l’altitude ${site.mapPosition ? 'carte' : 'du terrain'} (${fr(h * toM, 3)} m) : c’est attendu, RefElevation est indicative.`,
        'VERIFIE', 'geo.elevation')
    }
  }

  return {
    schema, fileSchemaRaw, authoringTool, coordinateBase, lengthUnit,
    status, statusCertainty, primarySource,
    geolocation: { located: !!(site?.refLatitude && site.refLongitude), siteStepId: site?.stepId ?? null },
    mapConversion, otherMapConversions, crs, sites, context, checks,
  }
}
