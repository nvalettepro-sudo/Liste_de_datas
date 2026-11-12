import * as WebIFC from 'web-ifc'
import { GRAPH_REL_TYPES } from '../lib/types'
import type {
  EntityTypeSummary,
  PsetData,
  PropertyEntry,
  AggregatedEntityData,
  AggregatedProperty,
  AggregatedPset,
  ValueAggregate,
  TextValueCount,
  GlobalSearchMatch,
  GlobalSearchResult,
  GraphRelType,
  GraphNode,
  GraphEdge,
  GraphPayload,
  TypeGraphNode,
  TypeGraphEdge,
  WorkerInMessage,
  WorkerOutMessage,
  ProjectInfo,
  StoreyInfo,
  GeoReference,
  GeoLocation,
  XYZ,
  InspectArg,
  InspectLine,
  InspectGroup,
  InspectOccurrence,
  InspectRequest,
  InspectResult,
  InspectFamily,
  OwnerHistoryInfo,
  UnitInfo,
} from '../lib/types'

let api: WebIFC.IfcAPI | null = null
let modelId = -1
let ifcVersion = 'IFC2X3'
let wasmBasePath: string | null = null

const typeCodeMap = new Map<string, number>()
const entityPsetMap = new Map<number, PsetData[]>()
const storeyCache = new Map<number, string | null>()
const aggregationCache = new Map<string, AggregatedEntityData>()

/** Octets du fichier et position de départ de chaque ligne « #id= » — l'inspecteur ne décode que la ligne demandée. */
let fileBytes: Uint8Array | null = null
const lineIndex = new Map<number, number>()

function post(msg: WorkerOutMessage) {
  self.postMessage(msg)
}

function valueToString(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v
  const obj = v as Record<string, unknown>
  if (obj.value !== undefined) return valueToString(obj.value)
  if (obj.Value !== undefined) return valueToString(obj.Value)
  return String(v)
}

function safeStr(v: unknown): string | null {
  const s = valueToString(v)
  return s === null || s === '' ? null : String(s)
}

async function initApi() {
  const instance = new WebIFC.IfcAPI()
  let wasmPath: string
  if (self.location.protocol === 'app:') {
    wasmPath = 'app:///'
  } else if (wasmBasePath) {
    wasmPath = wasmBasePath
  } else {
    wasmPath = '/'
  }
  instance.SetWasmPath(wasmPath, true)
  await instance.Init()
  api = instance
}

function buildStoreyCache() {
  if (!api || modelId < 0) return
  const rels = api.GetLineIDsWithType(modelId, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)
  for (let i = 0; i < rels.size(); i++) {
    const rel = api.GetLine(modelId, rels.get(i), false)
    if (!rel) continue
    const structRef = rel.RelatingStructure as Record<string, unknown>
    if (!structRef?.value) continue
    const struct = api.GetLine(modelId, structRef.value as number, false)
    if (!struct) continue
    if (api.GetNameFromTypeCode(struct.type as number) !== 'IfcBuildingStorey') continue
    const storeyName = safeStr(struct.Name)
    const related = rel.RelatedElements
    if (!Array.isArray(related)) continue
    for (const ref of related) {
      const r = ref as Record<string, unknown>
      if (r.value !== undefined) storeyCache.set(r.value as number, storeyName)
    }
  }
}

function extractPsetFromLine(pDef: Record<string, unknown>): PsetData | null {
  if (!api) return null
  const typeName = api.GetNameFromTypeCode(pDef.type as number)
  if (typeName !== 'IfcPropertySet' && typeName !== 'IfcElementQuantity') return null

  const psetName = safeStr(pDef.Name) ?? 'Unknown'
  const isStandard =
    psetName.startsWith('Pset_') || psetName.startsWith('Qto_') || psetName === 'BaseQuantities'
  const isQuantity = typeName === 'IfcElementQuantity'
  const propsRef = isQuantity ? pDef.Quantities : pDef.HasProperties
  const properties: PropertyEntry[] = []

  if (Array.isArray(propsRef)) {
    for (const propRef of propsRef) {
      const pRef = propRef as Record<string, unknown>
      if (!pRef?.value) continue
      const prop = api.GetLine(modelId, pRef.value as number, false)
      if (!prop) continue

      const propName = safeStr(prop.Name) ?? 'Unknown'
      let propValue: string | number | boolean | null = null
      let unit: string | undefined

      if (isQuantity) {
        const qVal =
          prop.LengthValue ?? prop.AreaValue ?? prop.VolumeValue ??
          prop.WeightValue ?? prop.CountValue ?? prop.TimeValue
        propValue = valueToString(qVal)
      } else {
        const nomVal = prop.NominalValue as Record<string, unknown> | undefined
        if (nomVal?.value !== undefined) propValue = valueToString(nomVal.value)
        const unitRef = prop.Unit as Record<string, unknown> | undefined
        if (unitRef?.value) {
          try {
            const u = api.GetLine(modelId, unitRef.value as number, false)
            if (u) unit = safeStr(u.Name) ?? undefined
          } catch { /* ignore */ }
        }
      }

      properties.push({
        name: propName,
        value: propValue,
        unit,
        id: pRef.value as number,
        valueAttr: isQuantity
          ? ['LengthValue', 'AreaValue', 'VolumeValue', 'WeightValue', 'CountValue', 'TimeValue'].find((k) => prop[k] !== undefined && prop[k] !== null)
          : 'NominalValue',
      })
    }
  }

  return { name: psetName, isStandard, properties, id: pDef.expressID as number }
}

function buildPsetMap() {
  if (!api || modelId < 0) return
  entityPsetMap.clear()

  const rels = api.GetLineIDsWithType(modelId, WebIFC.IFCRELDEFINESBYPROPERTIES)
  for (let i = 0; i < rels.size(); i++) {
    const rel = api.GetLine(modelId, rels.get(i), false)
    if (!rel) continue

    const relatedObjects = rel.RelatedObjects
    if (!Array.isArray(relatedObjects) || relatedObjects.length === 0) continue

    const pDefRef = rel.RelatingPropertyDefinition as Record<string, unknown>
    if (!pDefRef?.value) continue

    const pDef = api.GetLine(modelId, pDefRef.value as number, false)
    if (!pDef) continue

    const pset = extractPsetFromLine(pDef as Record<string, unknown>)
    if (!pset) continue
    pset.relId = rels.get(i)

    for (const objRef of relatedObjects) {
      const o = objRef as Record<string, unknown>
      if (o.value === undefined) continue
      const eid = o.value as number
      if (!entityPsetMap.has(eid)) entityPsetMap.set(eid, [])
      entityPsetMap.get(eid)!.push(pset)
    }
  }
}

const SI_PREFIX_SYMBOL: Record<string, string> = {
  EXA: 'E', PETA: 'P', TERA: 'T', GIGA: 'G', MEGA: 'M', KILO: 'k', HECTO: 'h', DECA: 'da',
  DECI: 'd', CENTI: 'c', MILLI: 'm', MICRO: 'µ', NANO: 'n', PICO: 'p', FEMTO: 'f', ATTO: 'a',
}
const SI_UNIT_SYMBOL: Record<string, string> = {
  METRE: 'm', SQUARE_METRE: 'm²', CUBIC_METRE: 'm³', GRAM: 'g', SECOND: 's', RADIAN: 'rad',
  STERADIAN: 'sr', DEGREE_CELSIUS: '°C', NEWTON: 'N', PASCAL: 'Pa', JOULE: 'J', WATT: 'W',
  AMPERE: 'A', VOLT: 'V', KELVIN: 'K', HERTZ: 'Hz', LUX: 'lx', LUMEN: 'lm', CANDELA: 'cd',
  MOLE: 'mol', COULOMB: 'C', FARAD: 'F', OHM: 'Ω', SIEMENS: 'S', WEBER: 'Wb', TESLA: 'T', HENRY: 'H',
  BECQUEREL: 'Bq', GRAY: 'Gy', SIEVERT: 'Sv',
}
const UNIT_TYPE_LABEL: Record<string, string> = {
  LENGTHUNIT: 'Longueur', AREAUNIT: 'Surface', VOLUMEUNIT: 'Volume', PLANEANGLEUNIT: 'Angle',
  SOLIDANGLEUNIT: 'Angle solide', MASSUNIT: 'Masse', TIMEUNIT: 'Temps',
  THERMODYNAMICTEMPERATUREUNIT: 'Température', FREQUENCYUNIT: 'Fréquence', FORCEUNIT: 'Force',
  PRESSUREUNIT: 'Pression', ENERGYUNIT: 'Énergie', POWERUNIT: 'Puissance',
  ELECTRICCURRENTUNIT: 'Courant électrique', ELECTRICVOLTAGEUNIT: 'Tension électrique',
  LUMINOUSFLUXUNIT: 'Flux lumineux', ILLUMINANCEUNIT: 'Éclairement', MONETARYUNIT: 'Monnaie',
}

/** Résout une référence STEP ({value: expressId}) vers la ligne pointée. */
function resolveRef(ref: unknown): Record<string, unknown> | null {
  if (!api) return null
  const r = ref as Record<string, unknown> | undefined
  if (!r || r.value === undefined) return null
  try {
    return api.GetLine(modelId, r.value as number, false) as Record<string, unknown>
  } catch {
    return null
  }
}

function numOf(raw: unknown): number | null {
  const v = valueToString(raw)
  return typeof v === 'number' ? v : null
}

/**
 * IfcCompoundPlaneAngleMeasure : [degrés, minutes, secondes, millionièmes de
 * seconde]. web-ifc renvoie la liste dans un wrapper `{ value: [...] }`
 * plutôt qu'un tableau nu (contrairement aux mesures simples déjà gérées par
 * valueToString), d'où le déballage explicite ici.
 */
function compoundAngleParts(raw: unknown): number[] | null {
  const wrapped = raw as Record<string, unknown> | undefined
  const list = Array.isArray(raw) ? raw : Array.isArray(wrapped?.value) ? wrapped!.value : null
  if (!Array.isArray(list) || list.length === 0) return null
  return list.map((v) => numOf(v) ?? 0)
}

function compoundAngleToDecimal(parts: number[]): number {
  const [deg, min = 0, sec = 0, micro = 0] = parts
  const sign = deg < 0 ? -1 : 1
  return sign * (Math.abs(deg) + min / 60 + sec / 3600 + micro / 3_600_000_000)
}

/** Même présentation que Solibri : 48°49'24,826450" */
function compoundAngleToDms(parts: number[]): string {
  const [deg, min = 0, sec = 0, micro = 0] = parts
  const seconds = (Math.abs(sec) + Math.abs(micro) / 1_000_000).toFixed(6).replace('.', ',')
  return `${deg}°${Math.abs(min)}'${seconds}"`
}

/**
 * Le MVD (Model View Definition) n'est pas porté par une entité mais par
 * l'en-tête STEP (FILE_DESCRIPTION), ex. "ViewDefinition [ReferenceView_V1.2]".
 * Extraction directe du texte plutôt que via l'API : plus simple et tout
 * aussi fiable, l'en-tête étant toujours en tête de fichier en clair.
 */
function extractMvd(buffer: ArrayBuffer): string | null {
  try {
    const head = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4096))
    const text = new TextDecoder('utf-8', { fatal: false }).decode(head)
    const m = text.match(/ViewDefinition\s*\[([^\]]+)\]/i)
    return m ? m[1].trim() : null
  } catch {
    return null
  }
}

function buildStoreys(): StoreyInfo[] {
  if (!api) return []
  const ids = api.GetLineIDsWithType(modelId, WebIFC.IFCBUILDINGSTOREY)
  const storeys: StoreyInfo[] = []
  for (let i = 0; i < ids.size(); i++) {
    const line = api.GetLine(modelId, ids.get(i), false) as Record<string, unknown>
    if (!line) continue
    storeys.push({ id: ids.get(i), name: safeStr(line.Name), elevation: numOf(line.Elevation) })
  }
  storeys.sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0))
  return storeys
}

type Vec3 = [number, number, number]
interface Frame { o: Vec3; x: Vec3; y: Vec3; z: Vec3 }

function vecOf(raw: unknown, fallback: Vec3): Vec3 {
  const line = resolveRef(raw)
  const list = (line?.Coordinates ?? line?.DirectionRatios) as unknown
  const wrapped = list as Record<string, unknown> | undefined
  const arr = Array.isArray(list) ? list : Array.isArray(wrapped?.value) ? (wrapped!.value as unknown[]) : null
  if (!arr) return fallback
  const n = arr.map((v) => numOf(v) ?? 0)
  return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0]
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

/** IfcAxis2Placement3D → repère orthonormé (Z = Axis, X = RefDirection orthogonalisée). */
function frameOfAxis2Placement(ref: unknown): Frame {
  const line = resolveRef(ref)
  const o = line ? vecOf(line.Location, [0, 0, 0]) : ([0, 0, 0] as Vec3)
  const z = norm(line ? vecOf(line.Axis, [0, 0, 1]) : [0, 0, 1])
  let x = line ? vecOf(line.RefDirection, [1, 0, 0]) : ([1, 0, 0] as Vec3)
  const d = dot(x, z)
  x = norm([x[0] - d * z[0], x[1] - d * z[1], x[2] - d * z[2]])
  return { o, x, y: cross(z, x), z }
}

/** Compose la chaîne IfcLocalPlacement (PlacementRelTo) jusqu'au repère du modèle. */
function absolutePlacement(placementRef: unknown, depth = 0): Frame | null {
  const pl = resolveRef(placementRef)
  if (!pl || depth > 32) return null
  const local = frameOfAxis2Placement(pl.RelativePlacement)
  const parent = pl.PlacementRelTo ? absolutePlacement(pl.PlacementRelTo, depth + 1) : null
  if (!parent) return local
  const apply = (v: Vec3): Vec3 => [
    parent.x[0] * v[0] + parent.y[0] * v[1] + parent.z[0] * v[2],
    parent.x[1] * v[0] + parent.y[1] * v[1] + parent.z[1] * v[2],
    parent.x[2] * v[0] + parent.y[2] * v[1] + parent.z[2] * v[2],
  ]
  const po = apply(local.o)
  return {
    o: [parent.o[0] + po[0], parent.o[1] + po[1], parent.o[2] + po[2]],
    x: apply(local.x),
    y: apply(local.y),
    z: apply(local.z),
  }
}

function unitSymbol(line: Record<string, unknown>): string {
  const name = safeStr(line.Name) ?? ''
  const prefix = safeStr(line.Prefix)
  if (!prefix && !SI_UNIT_SYMBOL[name] && line.ConversionFactor !== undefined) return name
  return (prefix ? SI_PREFIX_SYMBOL[prefix] ?? prefix : '') + (SI_UNIT_SYMBOL[name] ?? name.toLowerCase())
}

/**
 * GÉOLOCALISATION — latitude/longitude de l'IfcSite (toutes versions IFC).
 */
function buildGeolocation(): GeoLocation | null {
  if (!api) return null
  const siteIds = api.GetLineIDsWithType(modelId, WebIFC.IFCSITE)
  if (siteIds.size() === 0) return null
  const site = api.GetLine(modelId, siteIds.get(0), false) as Record<string, unknown>
  const lat = compoundAngleParts(site.RefLatitude)
  const lon = compoundAngleParts(site.RefLongitude)
  const elevation = numOf(site.RefElevation)
  if (!lat && !lon && elevation === null) return null
  return {
    latitude: lat ? compoundAngleToDecimal(lat) : null,
    longitude: lon ? compoundAngleToDecimal(lon) : null,
    latitudeDms: lat ? compoundAngleToDms(lat) : null,
    longitudeDms: lon ? compoundAngleToDms(lon) : null,
    elevation,
  }
}

/**
 * GÉORÉFÉRENCEMENT — repère de coordonnées projetées : IfcProjectedCRS +
 * IfcMapConversion (IFC4+ uniquement), position X/Y/Z de l'IfcSite obtenue en
 * composant sa chaîne d'IfcLocalPlacement (valable dans toutes les versions —
 * c'est là que Revit/Solibri lisent les « coordonnées globales »), et Nord vrai.
 */
function buildGeoreference(schema: string): GeoReference | null {
  if (!api) return null

  let crs: GeoReference['crs'] = null
  let mapConversion: GeoReference['mapConversion'] = null
  if (schema !== 'IFC2X3') {
    const mcIds = api.GetLineIDsWithType(modelId, WebIFC.IFCMAPCONVERSION)
    if (mcIds.size() > 0) {
      const mc = api.GetLine(modelId, mcIds.get(0), false) as Record<string, unknown>
      const xAbs = numOf(mc.XAxisAbscissa) ?? 1
      const xOrd = numOf(mc.XAxisOrdinate) ?? 0
      mapConversion = {
        eastings: numOf(mc.Eastings),
        northings: numOf(mc.Northings),
        orthogonalHeight: numOf(mc.OrthogonalHeight),
        rotation: (Math.atan2(xOrd, xAbs) * 180) / Math.PI,
        scale: numOf(mc.Scale) ?? 1,
      }
      const t = resolveRef(mc.TargetCRS)
      if (t) {
        const unit = resolveRef(t.MapUnit)
        crs = {
          name: safeStr(t.Name),
          description: safeStr(t.Description),
          geodeticDatum: safeStr(t.GeodeticDatum),
          verticalDatum: safeStr(t.VerticalDatum),
          mapProjection: safeStr(t.MapProjection),
          mapZone: safeStr(t.MapZone),
          mapUnit: unit ? unitSymbol(unit) : null,
        }
      }
    } else {
      // IfcProjectedCRS déclaré sans IfcMapConversion : on garde le système.
      const crsIds = api.GetLineIDsWithType(modelId, WebIFC.IFCPROJECTEDCRS)
      if (crsIds.size() > 0) {
        const t = api.GetLine(modelId, crsIds.get(0), false) as Record<string, unknown>
        const unit = resolveRef(t.MapUnit)
        crs = {
          name: safeStr(t.Name),
          description: safeStr(t.Description),
          geodeticDatum: safeStr(t.GeodeticDatum),
          verticalDatum: safeStr(t.VerticalDatum),
          mapProjection: safeStr(t.MapProjection),
          mapZone: safeStr(t.MapZone),
          mapUnit: unit ? unitSymbol(unit) : null,
        }
      }
    }
  }

  let sitePosition: XYZ | null = null
  const siteIds = api.GetLineIDsWithType(modelId, WebIFC.IFCSITE)
  if (siteIds.size() > 0) {
    const site = api.GetLine(modelId, siteIds.get(0), false) as Record<string, unknown>
    const frame = site.ObjectPlacement ? absolutePlacement(site.ObjectPlacement) : null
    if (frame) sitePosition = { x: frame.o[0], y: frame.o[1], z: frame.o[2] }
  }

  let projectedPosition: XYZ | null = null
  if (sitePosition && mapConversion) {
    const a = Math.cos((mapConversion.rotation! * Math.PI) / 180)
    const b = Math.sin((mapConversion.rotation! * Math.PI) / 180)
    const sc = mapConversion.scale ?? 1
    projectedPosition = {
      x: (mapConversion.eastings ?? 0) + sc * (a * sitePosition.x - b * sitePosition.y),
      y: (mapConversion.northings ?? 0) + sc * (b * sitePosition.x + a * sitePosition.y),
      z: (mapConversion.orthogonalHeight ?? 0) + sitePosition.z,
    }
  }

  let trueNorth: number | null = null
  const ctxIds = api.GetLineIDsWithType(modelId, WebIFC.IFCGEOMETRICREPRESENTATIONCONTEXT)
  for (let i = 0; i < ctxIds.size() && trueNorth === null; i++) {
    const ctx = api.GetLine(modelId, ctxIds.get(i), false) as Record<string, unknown>
    if (!ctx?.TrueNorth) continue
    const d = vecOf(ctx.TrueNorth, [0, 1, 0])
    // Angle par rapport à l'axe Y, positif vers l'ouest (convention IFC : direction du Nord).
    trueNorth = (Math.atan2(-d[0], d[1]) * 180) / Math.PI
  }

  if (!crs && !mapConversion && !sitePosition && trueNorth === null) return null
  return { crs, mapConversion, sitePosition, projectedPosition, trueNorth }
}

function buildOwnerHistory(): OwnerHistoryInfo | null {
  if (!api) return null
  const ids = api.GetLineIDsWithType(modelId, WebIFC.IFCOWNERHISTORY)
  if (ids.size() === 0) return null
  const oh = api.GetLine(modelId, ids.get(0), false) as Record<string, unknown>

  const fmtDate = (raw: unknown): string | null => {
    const ts = numOf(raw)
    if (ts === null) return null
    try {
      return new Date(ts * 1000).toLocaleString('fr-FR')
    } catch {
      return null
    }
  }

  const owningUser = resolveRef(oh.OwningUser)
  const person = owningUser ? resolveRef(owningUser.ThePerson) : null
  const org = owningUser ? resolveRef(owningUser.TheOrganization) : null
  const personName = person
    ? [safeStr(person.GivenName), safeStr(person.FamilyName)].filter(Boolean).join(' ') || null
    : null

  const app = resolveRef(oh.OwningApplication)
  const developer = app ? resolveRef(app.ApplicationDeveloper) : null

  return {
    creationDate: fmtDate(oh.CreationDate),
    lastModifiedDate: fmtDate(oh.LastModifiedDate),
    personName,
    organizationName: org ? safeStr(org.Name) : null,
    applicationName: app ? safeStr(app.ApplicationFullName) : null,
    applicationVersion: app ? safeStr(app.Version) : null,
    applicationDeveloper: developer ? safeStr(developer.Name) : null,
  }
}

/**
 * N'indexe que les unités SI/dérivées/monétaires réellement déclarées dans le
 * fichier — en pratique toujours celles de l'unique IfcUnitAssignment du
 * projet, ce qui évite d'avoir à remonter la référence depuis IfcProject.
 */
function buildUnits(): UnitInfo[] {
  if (!api) return []
  const units: UnitInfo[] = []

  const siIds = api.GetLineIDsWithType(modelId, WebIFC.IFCSIUNIT)
  for (let i = 0; i < siIds.size(); i++) {
    const line = api.GetLine(modelId, siIds.get(i), false) as Record<string, unknown>
    if (!line) continue
    const unitType = safeStr(line.UnitType) ?? 'USERDEFINED'
    const name = safeStr(line.Name) ?? ''
    const prefix = safeStr(line.Prefix)
    const symbol = (prefix ? SI_PREFIX_SYMBOL[prefix] ?? prefix : '') + (SI_UNIT_SYMBOL[name] ?? name.toLowerCase())
    units.push({ id: siIds.get(i), unitType, label: `${UNIT_TYPE_LABEL[unitType] ?? unitType} : ${symbol}` })
  }

  const cbIds = api.GetLineIDsWithType(modelId, WebIFC.IFCCONVERSIONBASEDUNIT)
  for (let i = 0; i < cbIds.size(); i++) {
    const line = api.GetLine(modelId, cbIds.get(i), false) as Record<string, unknown>
    if (!line) continue
    const unitType = safeStr(line.UnitType) ?? 'USERDEFINED'
    const name = safeStr(line.Name) ?? ''
    units.push({ id: cbIds.get(i), unitType, label: `${UNIT_TYPE_LABEL[unitType] ?? unitType} : ${name}` })
  }

  const monIds = api.GetLineIDsWithType(modelId, WebIFC.IFCMONETARYUNIT)
  for (let i = 0; i < monIds.size(); i++) {
    const line = api.GetLine(modelId, monIds.get(i), false) as Record<string, unknown>
    if (!line) continue
    const currency = safeStr(line.Currency) ?? 'Devise'
    units.push({ id: monIds.get(i), unitType: 'MONETARYUNIT', label: `${UNIT_TYPE_LABEL.MONETARYUNIT} : ${currency}` })
  }

  return units
}

function buildProjectInfo(buffer: ArrayBuffer, schema: string): ProjectInfo {
  const firstId = (type: number): number | null => {
    if (!api) return null
    const ids = api.GetLineIDsWithType(modelId, type)
    return ids.size() > 0 ? ids.get(0) : null
  }
  const info: ProjectInfo = {
    ids: {
      project: firstId(WebIFC.IFCPROJECT),
      site: firstId(WebIFC.IFCSITE),
      building: firstId(WebIFC.IFCBUILDING),
      ownerHistory: firstId(WebIFC.IFCOWNERHISTORY),
    },
    schema,
    mvd: extractMvd(buffer),
    projectName: null,
    projectLongName: null,
    projectPhase: null,
    siteName: null,
    siteAddress: null,
    buildingName: null,
    storeys: buildStoreys(),
    georeference: buildGeoreference(schema),
    geolocation: buildGeolocation(),
    ownerHistory: buildOwnerHistory(),
    units: buildUnits(),
  }

  if (!api) return info

  const projIds = api.GetLineIDsWithType(modelId, WebIFC.IFCPROJECT)
  if (projIds.size() > 0) {
    const p = api.GetLine(modelId, projIds.get(0), false) as Record<string, unknown>
    info.projectName = safeStr(p.Name)
    info.projectLongName = safeStr(p.LongName)
    info.projectPhase = safeStr(p.Phase)
  }

  const siteIds = api.GetLineIDsWithType(modelId, WebIFC.IFCSITE)
  if (siteIds.size() > 0) {
    const s = api.GetLine(modelId, siteIds.get(0), false) as Record<string, unknown>
    info.siteName = safeStr(s.Name)
    const addr = resolveRef(s.SiteAddress)
    if (addr) {
      info.siteAddress =
        [safeStr(addr.Town), safeStr(addr.Region), safeStr(addr.PostalCode), safeStr(addr.Country)]
          .filter(Boolean)
          .join(', ') || null
    }
  }

  const buildIds = api.GetLineIDsWithType(modelId, WebIFC.IFCBUILDING)
  if (buildIds.size() > 0) {
    const b = api.GetLine(modelId, buildIds.get(0), false) as Record<string, unknown>
    info.buildingName = safeStr(b.Name)
  }

  return info
}

async function loadFile(buffer: ArrayBuffer) {
  post({ type: 'progress', percent: 5, phase: 'Initialisation du moteur IFC…' })
  await initApi()
  if (!api) return

  post({ type: 'progress', percent: 15, phase: 'Chargement du fichier…' })

  fileBytes = new Uint8Array(buffer)
  try {
    modelId = api.OpenModel(fileBytes, { COORDINATE_TO_ORIGIN: false })
  } catch (e) {
    post({ type: 'error', message: `Erreur de chargement: ${e}` })
    return
  }

  typeCodeMap.clear()
  entityPsetMap.clear()
  storeyCache.clear()
  lineIndex.clear()
  aggregationCache.clear()
  outRels.clear()
  inRels.clear()
  nodeMetaCache.clear()
  groupMembers.clear()
  indexedRelTypes = new Set()
  typeNameCache.clear()
  typeGraphCounts.clear()
  entityTypeCounts.clear()

  try {
    const header = api.GetModelSchema(modelId)
    if (header?.includes('IFC4X3') || header?.includes('IFC4x3')) ifcVersion = 'IFC4X3'
    else if (header?.includes('IFC4')) ifcVersion = 'IFC4'
    else ifcVersion = 'IFC2X3'
  } catch { ifcVersion = 'IFC2X3' }

  post({ type: 'progress', percent: 22, phase: 'Index des lignes du fichier…' })
  buildLineIndex()

  post({ type: 'progress', percent: 25, phase: 'Index des niveaux…' })
  buildStoreyCache()

  post({ type: 'progress', percent: 40, phase: 'Index des propriétés (Psets)…' })
  buildPsetMap()

  post({ type: 'progress', percent: 60, phase: "Analyse des types d'entités…" })

  const typeSummaries: EntityTypeSummary[] = []
  const allTypes = api.GetAllTypesOfModel(modelId)

  for (let i = 0; i < allTypes.length; i++) {
    const { typeID, typeName } = allTypes[i]
    if (!typeName || !typeName.startsWith('Ifc') || typeName.startsWith('IfcRel')) continue

    const lineIds = api.GetLineIDsWithType(modelId, typeID)
    const count = lineIds.size()
    if (count === 0) continue

    typeCodeMap.set(typeName, typeID)
    entityTypeCounts.set(typeName, count)
    typeSummaries.push({ type: typeName, count, storeyBreakdown: {} })

    if (i % 50 === 0) {
      const pct = 60 + Math.round((i / allTypes.length) * 30)
      post({ type: 'progress', percent: pct, phase: `Types… (${i}/${allTypes.length})` })
    }
  }

  typeSummaries.sort((a, b) => b.count - a.count)

  post({ type: 'progress', percent: 90, phase: 'Informations projet…' })
  try {
    post({ type: 'projectInfo', data: buildProjectInfo(buffer, ifcVersion) })
  } catch {
    // Un fichier atypique (IfcProject/IfcSite absents ou malformés) ne doit
    // pas empêcher le chargement du reste de la maquette.
  }

  post({ type: 'progress', percent: 95, phase: 'Finalisation…' })
  post({ type: 'ready', entityTypes: typeSummaries, ifcVersion })
}

const ATTR_KEYS = ['Name', 'ObjectType', 'Description', 'PredefinedType']

function buildTextAggregate(
  textMap: Map<string, number>,
  presentCount: number,
  totalCount: number
): ValueAggregate {
  const distinctValues: TextValueCount[] = Array.from(textMap.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
  return { kind: 'text', distinctValues, presentCount, totalCount }
}

function buildNumericAggregate(
  range: { min: number; max: number },
  presentCount: number,
  totalCount: number
): ValueAggregate {
  return { kind: 'numeric', min: range.min, max: range.max, presentCount, totalCount }
}

function searchGlobal(query: string) {
  if (!api || modelId < 0) return
  const q = query.toLowerCase()
  const results: GlobalSearchResult[] = []

  for (const [typeName, typeCode] of typeCodeMap.entries()) {
    const lineIds = api.GetLineIDsWithType(modelId, typeCode)
    const total = lineIds.size()
    if (total === 0) continue

    const matchSet = new Set<number>()
    const matches: GlobalSearchMatch[] = []
    const psetMatchCount = new Map<string, number>()
    const propMatchCount = new Map<string, number>()
    const valMatchCount = new Map<string, number>()

    for (let i = 0; i < total; i++) {
      const expressId = lineIds.get(i)
      const psets = entityPsetMap.get(expressId) ?? []
      let entityMatched = false

      for (const pset of psets) {
        const psetNameMatch = pset.name.toLowerCase().includes(q)

        for (const prop of pset.properties) {
          const propNameMatch = prop.name.toLowerCase().includes(q)
          const valStr = prop.value !== null ? String(prop.value).toLowerCase() : ''
          const valMatch = valStr.includes(q)

          if (psetNameMatch) {
            psetMatchCount.set(pset.name, (psetMatchCount.get(pset.name) ?? 0) + 1)
            entityMatched = true
          }
          if (propNameMatch) {
            propMatchCount.set(`${pset.name}::${prop.name}`, (propMatchCount.get(`${pset.name}::${prop.name}`) ?? 0) + 1)
            entityMatched = true
          }
          if (valMatch) {
            valMatchCount.set(`${pset.name}::${prop.name}`, (valMatchCount.get(`${pset.name}::${prop.name}`) ?? 0) + 1)
            entityMatched = true
          }
        }
      }

      if (entityMatched) matchSet.add(expressId)
    }

    if (matchSet.size === 0) continue

    for (const [psetName, count] of psetMatchCount.entries()) {
      matches.push({ matchType: 'pset', psetName, occurrences: count })
    }
    for (const [key, count] of propMatchCount.entries()) {
      const [psetName, propertyName] = key.split('::')
      matches.push({ matchType: 'property', psetName, propertyName, occurrences: count })
    }
    for (const [key, count] of valMatchCount.entries()) {
      const [psetName, propertyName] = key.split('::')
      if (!propMatchCount.has(key)) {
        matches.push({ matchType: 'value', psetName, propertyName, occurrences: count })
      }
    }

    results.push({ entityType: typeName, totalCount: total, matchingCount: matchSet.size, matches })
  }

  results.sort((a, b) => b.matchingCount - a.matchingCount)
  post({ type: 'searchResults', query, results })
}

async function selectEntityType(entityType: string) {
  if (!api || modelId < 0) return

  if (aggregationCache.has(entityType)) {
    post({ type: 'progress', percent: 100, phase: 'Terminé' })
    post({ type: 'aggregated', data: aggregationCache.get(entityType)! })
    return
  }

  post({ type: 'progress', percent: 10, phase: `Chargement des ${entityType}…` })

  const typeCode = typeCodeMap.get(entityType)
  if (typeCode === undefined) {
    post({ type: 'error', message: `Type inconnu: ${entityType}` })
    return
  }

  const lineIds = api.GetLineIDsWithType(modelId, typeCode)
  const total = lineIds.size()

  const attrTextMap = new Map<string, Map<string, number>>()
  const attrNumMap = new Map<string, { min: number; max: number }>()
  const attrPresentCount = new Map<string, number>()

  const psetPresentCount = new Map<string, number>()
  const psetIsStandard = new Map<string, boolean>()
  const psetPropTextMap = new Map<string, Map<string, Map<string, number>>>()
  const psetPropNumMap = new Map<string, Map<string, { min: number; max: number }>>()
  const psetPropPresentCount = new Map<string, Map<string, number>>()

  for (let i = 0; i < total; i++) {
    const expressId = lineIds.get(i)

    let line: Record<string, unknown>
    try {
      line = api.GetLine(modelId, expressId, false) as Record<string, unknown>
    } catch { continue }

    for (const attr of ATTR_KEYS) {
      const rawVal = line[attr]
      if (rawVal === null || rawVal === undefined) continue
      const val = valueToString(rawVal)
      if (val === null) continue

      attrPresentCount.set(attr, (attrPresentCount.get(attr) ?? 0) + 1)

      if (typeof val === 'number') {
        if (!attrNumMap.has(attr)) {
          attrNumMap.set(attr, { min: val, max: val })
        } else {
          const r = attrNumMap.get(attr)!
          if (val < r.min) r.min = val
          if (val > r.max) r.max = val
        }
      } else {
        const strVal = String(val)
        if (!attrTextMap.has(attr)) attrTextMap.set(attr, new Map())
        const m = attrTextMap.get(attr)!
        m.set(strVal, (m.get(strVal) ?? 0) + 1)
      }
    }

    const psets = entityPsetMap.get(expressId) ?? []
    for (const pset of psets) {
      psetPresentCount.set(pset.name, (psetPresentCount.get(pset.name) ?? 0) + 1)
      psetIsStandard.set(pset.name, pset.isStandard)

      if (!psetPropTextMap.has(pset.name)) psetPropTextMap.set(pset.name, new Map())
      if (!psetPropNumMap.has(pset.name)) psetPropNumMap.set(pset.name, new Map())
      if (!psetPropPresentCount.has(pset.name)) psetPropPresentCount.set(pset.name, new Map())

      const propTextMap = psetPropTextMap.get(pset.name)!
      const propNumMap = psetPropNumMap.get(pset.name)!
      const propCountMap = psetPropPresentCount.get(pset.name)!

      for (const prop of pset.properties) {
        if (prop.value === null || prop.value === '') continue

        propCountMap.set(prop.name, (propCountMap.get(prop.name) ?? 0) + 1)

        if (typeof prop.value === 'number') {
          const v = prop.value
          if (!propNumMap.has(prop.name)) {
            propNumMap.set(prop.name, { min: v, max: v })
          } else {
            const r = propNumMap.get(prop.name)!
            if (v < r.min) r.min = v
            if (v > r.max) r.max = v
          }
        } else {
          const strVal = String(prop.value)
          if (!propTextMap.has(prop.name)) propTextMap.set(prop.name, new Map())
          const m = propTextMap.get(prop.name)!
          m.set(strVal, (m.get(strVal) ?? 0) + 1)
        }
      }
    }

    if (i % 200 === 0) {
      const pct = 10 + Math.round((i / total) * 85)
      post({ type: 'progress', percent: pct, phase: `${i + 1}/${total} ${entityType}…` })
    }
  }

  const attributes: AggregatedProperty[] = []
  for (const attr of ATTR_KEYS) {
    const presentCount = attrPresentCount.get(attr) ?? 0
    if (presentCount === 0) continue

    let aggregate: ValueAggregate
    if (attrNumMap.has(attr)) {
      aggregate = buildNumericAggregate(attrNumMap.get(attr)!, presentCount, total)
    } else if (attrTextMap.has(attr)) {
      aggregate = buildTextAggregate(attrTextMap.get(attr)!, presentCount, total)
    } else {
      aggregate = { kind: 'empty', presentCount, totalCount: total }
    }
    attributes.push({ name: attr, aggregate })
  }

  const standardPsets: AggregatedPset[] = []
  const customPsets: AggregatedPset[] = []

  for (const [psetName, presentCount] of psetPresentCount.entries()) {
    const isStandard = psetIsStandard.get(psetName) ?? false
    const propTextMap = psetPropTextMap.get(psetName) ?? new Map()
    const propNumMap = psetPropNumMap.get(psetName) ?? new Map()
    const propCountMap = psetPropPresentCount.get(psetName) ?? new Map()

    const allPropNames = new Set([...propTextMap.keys(), ...propNumMap.keys(), ...propCountMap.keys()])
    const properties: AggregatedProperty[] = []

    for (const propName of allPropNames) {
      const propPresent = propCountMap.get(propName) ?? 0
      let aggregate: ValueAggregate

      if (propNumMap.has(propName)) {
        aggregate = buildNumericAggregate(propNumMap.get(propName)!, propPresent, total)
      } else if (propTextMap.has(propName)) {
        aggregate = buildTextAggregate(propTextMap.get(propName)!, propPresent, total)
      } else {
        aggregate = { kind: 'empty', presentCount: propPresent, totalCount: total }
      }
      properties.push({ name: propName, aggregate })
    }

    properties.sort((a, b) => a.name.localeCompare(b.name))

    const aggPset: AggregatedPset = { name: psetName, isStandard, presentCount, totalCount: total, properties }

    if (isStandard) standardPsets.push(aggPset)
    else customPsets.push(aggPset)
  }

  standardPsets.sort((a, b) => b.presentCount - a.presentCount)
  customPsets.sort((a, b) => b.presentCount - a.presentCount)

  const data: AggregatedEntityData = {
    entityType,
    totalCount: total,
    attributes,
    standardPsets,
    customPsets,
  }

  aggregationCache.set(entityType, data)

  post({ type: 'progress', percent: 100, phase: 'Terminé' })
  post({ type: 'aggregated', data })
}

/* ==================== Vue graphe (v2) ==================== */

interface RawRel {
  relId: number
  relType: GraphRelType
  relGlobalId: string | null
  relatingId: number
  relatedId: number
}

/**
 * Attributs porteurs de chaque relation. Attention : les IfcRelAssociates* et
 * IfcRelAggregates exposent `RelatedObjects`, mais IfcRelContainedInSpatialStructure
 * utilise `RelatedElements`.
 */
const REL_ATTRS: Record<GraphRelType, { relating: string; related: string; code: number }> = {
  IfcRelAssociatesMaterial: {
    relating: 'RelatingMaterial', related: 'RelatedObjects', code: WebIFC.IFCRELASSOCIATESMATERIAL,
  },
  IfcRelAssociatesClassification: {
    relating: 'RelatingClassification', related: 'RelatedObjects', code: WebIFC.IFCRELASSOCIATESCLASSIFICATION,
  },
  IfcRelDefinesByType: {
    relating: 'RelatingType', related: 'RelatedObjects', code: WebIFC.IFCRELDEFINESBYTYPE,
  },
  IfcRelContainedInSpatialStructure: {
    relating: 'RelatingStructure', related: 'RelatedElements', code: WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE,
  },
  IfcRelAggregates: {
    relating: 'RelatingObject', related: 'RelatedObjects', code: WebIFC.IFCRELAGGREGATES,
  },
  IfcRelDefinesByProperties: {
    relating: 'RelatingPropertyDefinition', related: 'RelatedObjects', code: WebIFC.IFCRELDEFINESBYPROPERTIES,
  },
}

const SPATIAL_TYPES = new Set([
  'IfcProject', 'IfcSite', 'IfcBuilding', 'IfcBuildingStorey',
  'IfcSpace', 'IfcSpatialZone', 'IfcSpatialStructureElement',
])

/** Au-delà, un groupe d'occurrences reste replié au lieu d'être éclaté. */
const GROUP_EXPLODE_THRESHOLD = 20
/** Plafond de nœuds renvoyés par expansion (contrainte §6). */
const MAX_EXPANSION_NODES = 150

const outRels = new Map<number, RawRel[]>()
const inRels = new Map<number, RawRel[]>()
const nodeMetaCache = new Map<number, GraphNode>()
/** Membres des nœuds groupés déjà émis, pour pouvoir les ré-étendre. */
const groupMembers = new Map<string, number[]>()

/** Type d'entité par expressId — cache léger, séparé de nodeMetaCache qui porte le libellé complet. */
const typeNameCache = new Map<number, string>()
/** Occurrences par (relType, typeRelating, typeRelated) — alimente la vue d'ensemble. */
const typeGraphCounts = new Map<string, number>()
/** Nombre total d'instances par type IFC, capturé pendant l'analyse initiale. */
const entityTypeCounts = new Map<string, number>()

let indexedRelTypes = new Set<GraphRelType>()

function pushRel(map: Map<number, RawRel[]>, key: number, rel: RawRel) {
  const arr = map.get(key)
  if (arr) arr.push(rel)
  else map.set(key, [rel])
}

function getEntityType(expressId: number): string | null {
  const cached = typeNameCache.get(expressId)
  if (cached) return cached
  if (!api) return null
  let line: Record<string, unknown>
  try {
    line = api.GetLine(modelId, expressId, false) as Record<string, unknown>
  } catch { return null }
  if (!line) return null
  const t = api.GetNameFromTypeCode(line.type as number)
  if (t) typeNameCache.set(expressId, t)
  return t ?? null
}

function refIds(raw: unknown): number[] {
  if (raw === null || raw === undefined) return []
  if (Array.isArray(raw)) {
    const out: number[] = []
    for (const r of raw) {
      const o = r as Record<string, unknown>
      if (o?.value !== undefined) out.push(o.value as number)
    }
    return out
  }
  const o = raw as Record<string, unknown>
  return o?.value !== undefined ? [o.value as number] : []
}

/**
 * Indexe les relations demandées. L'index est incrémental : on ne réindexe que
 * les types de relation absents (IfcRelDefinesByProperties reste hors index
 * tant qu'il n'est pas explicitement coché, sa volumétrie étant très élevée).
 */
function buildRelationIndex(relTypes: GraphRelType[]) {
  if (!api || modelId < 0) return
  const missing = relTypes.filter((t) => !indexedRelTypes.has(t))
  if (missing.length === 0) return

  for (let t = 0; t < missing.length; t++) {
    const relType = missing[t]
    const { relating, related, code } = REL_ATTRS[relType]

    post({
      type: 'progress',
      percent: Math.round((t / missing.length) * 90),
      phase: `Index des relations : ${relType}…`,
    })

    let lineIds: { size(): number; get(i: number): number }
    try {
      lineIds = api.GetLineIDsWithType(modelId, code)
    } catch {
      indexedRelTypes.add(relType)
      continue
    }

    for (let i = 0; i < lineIds.size(); i++) {
      const relId = lineIds.get(i)
      let rel: Record<string, unknown>
      try {
        rel = api.GetLine(modelId, relId, false) as Record<string, unknown>
      } catch { continue }
      if (!rel) continue

      const relatingIds = refIds(rel[relating])
      const relatedIds = refIds(rel[related])
      if (relatingIds.length === 0 || relatedIds.length === 0) continue

      const relGlobalId = safeStr(rel.GlobalId)

      for (const relatingId of relatingIds) {
        const relatingType = getEntityType(relatingId)
        for (const relatedId of relatedIds) {
          const raw: RawRel = { relId, relType, relGlobalId, relatingId, relatedId }
          pushRel(outRels, relatingId, raw)
          pushRel(inRels, relatedId, raw)

          const relatedType = getEntityType(relatedId)
          if (relatingType && relatedType) {
            const key = `${relType}|${relatingType}|${relatedType}`
            typeGraphCounts.set(key, (typeGraphCounts.get(key) ?? 0) + 1)
          }
        }
      }
    }

    indexedRelTypes.add(relType)
  }

  post({ type: 'progress', percent: 100, phase: 'Terminé' })
}

function classifyKind(entityType: string): GraphNode['kind'] {
  if (SPATIAL_TYPES.has(entityType)) return 'spatial'
  if (
    entityType.startsWith('IfcMaterial') ||
    entityType.startsWith('IfcClassification') ||
    entityType === 'IfcPropertySet' ||
    entityType === 'IfcElementQuantity' ||
    entityType.endsWith('Type') ||
    entityType.endsWith('Style')
  ) {
    return 'definition'
  }
  return 'occurrence'
}

/**
 * Libellé lisible d'un nœud. Les définitions matériaux et classifications
 * portent leur nom sur des attributs différents selon le sous-type et le
 * schéma (IFC2X3 : `ItemReference`, IFC4+ : `Identification`).
 */
function resolveLabel(entityType: string, line: Record<string, unknown>): string {
  const name = safeStr(line.Name)

  switch (entityType) {
    case 'IfcMaterialLayerSet':
      return safeStr(line.LayerSetName) ?? 'Couches sans nom'

    case 'IfcMaterialLayerSetUsage':
    case 'IfcMaterialProfileSetUsage': {
      const forSet = (line.ForLayerSet ?? line.ForProfileSet) as Record<string, unknown> | undefined
      if (forSet?.value !== undefined && api) {
        try {
          const set = api.GetLine(modelId, forSet.value as number, false) as Record<string, unknown>
          if (set) return safeStr(set.LayerSetName) ?? safeStr(set.Name) ?? entityType
        } catch { /* libellé générique en repli */ }
      }
      return entityType
    }

    case 'IfcMaterialList': {
      const n = refIds(line.Materials).length
      return `Liste de ${n} matériau${n > 1 ? 'x' : ''}`
    }

    case 'IfcClassificationReference': {
      const ident = safeStr(line.Identification) ?? safeStr(line.ItemReference)
      if (name && ident) return `${ident} — ${name}`
      return ident ?? name ?? 'Référence sans nom'
    }

    case 'IfcBuildingStorey':
    case 'IfcSpace':
      return name ?? safeStr(line.LongName) ?? entityType

    default:
      return name ?? entityType
  }
}

function nodeMeta(expressId: number): GraphNode | null {
  const cached = nodeMetaCache.get(expressId)
  if (cached) return cached
  if (!api) return null

  let line: Record<string, unknown>
  try {
    line = api.GetLine(modelId, expressId, false) as Record<string, unknown>
  } catch { return null }
  if (!line) return null

  const entityType = api.GetNameFromTypeCode(line.type as number) ?? 'Inconnu'
  const node: GraphNode = {
    id: `e${expressId}`,
    kind: classifyKind(entityType),
    entityType,
    label: resolveLabel(entityType, line),
    expressId,
    globalId: safeStr(line.GlobalId),
    expandable: (outRels.get(expressId)?.length ?? 0) + (inRels.get(expressId)?.length ?? 0) > 0,
  }
  nodeMetaCache.set(expressId, node)
  return node
}

interface EdgeAcc {
  source: string
  target: string
  relType: GraphRelType
  count: number
  relGlobalId: string | null
}

/**
 * Calcule les voisins directs (1 saut) d'un ensemble d'occurrences.
 * Les nœuds définition et spatiaux restent individuels — c'est tout l'intérêt
 * de la vue : un matériau partagé par 400 murs n'apparaît qu'une fois. Les
 * occurrences, elles, sont regroupées par type au-delà du seuil d'éclatement.
 */
function neighborsOf(
  originId: string,
  memberIds: number[],
  relTypes: GraphRelType[]
): GraphPayload {
  const allowed = new Set(relTypes)
  const memberSet = new Set(memberIds)

  const nodesById = new Map<string, GraphNode>()
  const edgesByKey = new Map<string, EdgeAcc>()
  // Occurrences voisines, regroupées par type avant décision d'éclatement.
  const occGroups = new Map<string, { ids: Set<number>; rels: Map<GraphRelType, { asSource: boolean; count: number }> }>()

  const consider = (memberId: number, rel: RawRel) => {
    if (!allowed.has(rel.relType)) return
    const memberIsRelating = rel.relatingId === memberId
    const otherId = memberIsRelating ? rel.relatedId : rel.relatingId
    if (memberSet.has(otherId)) return // relation interne au groupe

    const meta = nodeMeta(otherId)
    if (!meta) return

    if (meta.kind === 'occurrence') {
      let g = occGroups.get(meta.entityType)
      if (!g) {
        g = { ids: new Set(), rels: new Map() }
        occGroups.set(meta.entityType, g)
      }
      g.ids.add(otherId)
      const key = rel.relType
      const cur = g.rels.get(key)
      if (cur) cur.count++
      else g.rels.set(key, { asSource: !memberIsRelating, count: 1 })
      return
    }

    // Définition ou nœud spatial : conservé tel quel, l'agrégation se fait sur l'arête.
    nodesById.set(meta.id, meta)
    const source = memberIsRelating ? originId : meta.id
    const target = memberIsRelating ? meta.id : originId
    const key = `${rel.relType}|${source}|${target}`
    const acc = edgesByKey.get(key)
    if (acc) {
      acc.count++
      acc.relGlobalId = null // plusieurs relations agrégées : plus de GUID unique
    } else {
      edgesByKey.set(key, { source, target, relType: rel.relType, count: 1, relGlobalId: rel.relGlobalId })
    }
  }

  for (const memberId of memberIds) {
    const out = outRels.get(memberId)
    if (out) for (const r of out) consider(memberId, r)
    const inc = inRels.get(memberId)
    if (inc) for (const r of inc) consider(memberId, r)
  }

  // Matérialisation des occurrences voisines : éclatées si peu nombreuses, sinon groupées.
  for (const [entityType, g] of occGroups.entries()) {
    const ids = Array.from(g.ids)
    const explode = ids.length <= GROUP_EXPLODE_THRESHOLD

    for (const [relType, info] of g.rels.entries()) {
      if (explode) {
        for (const id of ids) {
          const meta = nodeMeta(id)
          if (!meta) continue
          nodesById.set(meta.id, meta)
          const source = info.asSource ? meta.id : originId
          const target = info.asSource ? originId : meta.id
          const key = `${relType}|${source}|${target}`
          if (!edgesByKey.has(key)) {
            edgesByKey.set(key, { source, target, relType, count: 1, relGlobalId: null })
          }
        }
      } else {
        const groupId = `g:${originId}:${entityType}`
        groupMembers.set(groupId, ids)
        nodesById.set(groupId, {
          id: groupId,
          kind: 'group',
          entityType,
          label: `${ids.length} ${entityType}`,
          count: ids.length,
          expandable: true,
        })
        const source = info.asSource ? groupId : originId
        const target = info.asSource ? originId : groupId
        edgesByKey.set(`${relType}|${source}|${target}`, {
          source, target, relType, count: info.count, relGlobalId: null,
        })
      }
    }
  }

  // Plafond de rendu : on garde les voisins les plus significatifs.
  let nodes = Array.from(nodesById.values())
  let truncated = false
  let omittedCount = 0

  if (nodes.length > MAX_EXPANSION_NODES) {
    const weight = new Map<string, number>()
    for (const e of edgesByKey.values()) {
      const other = e.source === originId ? e.target : e.source
      weight.set(other, (weight.get(other) ?? 0) + e.count)
    }
    nodes.sort((a, b) => (weight.get(b.id) ?? 0) - (weight.get(a.id) ?? 0))
    omittedCount = nodes.length - MAX_EXPANSION_NODES
    nodes = nodes.slice(0, MAX_EXPANSION_NODES)
    truncated = true
  }

  const kept = new Set(nodes.map((n) => n.id))
  const edges: GraphEdge[] = []
  for (const [key, e] of edgesByKey.entries()) {
    const other = e.source === originId ? e.target : e.source
    if (!kept.has(other)) continue
    edges.push({
      id: key,
      source: e.source,
      target: e.target,
      relType: e.relType,
      count: e.count,
      relGlobalId: e.relGlobalId,
    })
  }

  return { originId, nodes, edges, truncated, omittedCount }
}

function graphOpenType(entityType: string, relTypes: GraphRelType[]) {
  if (!api || modelId < 0) return
  buildRelationIndex(relTypes)

  const typeCode = typeCodeMap.get(entityType)
  if (typeCode === undefined) {
    post({ type: 'error', message: `Type inconnu: ${entityType}` })
    return
  }

  const lineIds = api.GetLineIDsWithType(modelId, typeCode)
  const memberIds: number[] = []
  for (let i = 0; i < lineIds.size(); i++) memberIds.push(lineIds.get(i))

  const rootId = `g:root:${entityType}`
  groupMembers.set(rootId, memberIds)

  const payload = neighborsOf(rootId, memberIds, relTypes)

  // Le nœud racine est joint au payload pour que le store puisse l'ancrer.
  payload.nodes.unshift({
    id: rootId,
    kind: 'group',
    entityType,
    label: `${memberIds.length} ${entityType}`,
    count: memberIds.length,
    expandable: true,
  })

  post({ type: 'graphData', payload })
}

function graphExpand(nodeId: string, relTypes: GraphRelType[]) {
  if (!api || modelId < 0) return
  buildRelationIndex(relTypes)

  let memberIds: number[]
  if (nodeId.startsWith('g:')) {
    memberIds = groupMembers.get(nodeId) ?? []
  } else {
    memberIds = [Number(nodeId.slice(1))]
  }

  if (memberIds.length === 0) {
    post({ type: 'graphData', payload: { originId: nodeId, nodes: [], edges: [], truncated: false, omittedCount: 0 } })
    return
  }

  post({ type: 'graphData', payload: neighborsOf(nodeId, memberIds, relTypes) })
}

/**
 * Vue d'ensemble de la maquette : un nœud par type IFC présent, une arête par
 * relation officielle entre deux types avec son compte réel d'occurrences.
 * Toujours calculée sur les 6 relations du scope — à cette maille,
 * IfcRelDefinesByProperties n'ajoute que quelques arêtes, pas une explosion
 * d'instances comme au niveau détail.
 */
function graphOverview() {
  if (!api || modelId < 0) return
  buildRelationIndex([...GRAPH_REL_TYPES])

  const involved = new Set<string>()
  const edges: TypeGraphEdge[] = []

  for (const [key, count] of typeGraphCounts.entries()) {
    const [relType, relatingType, relatedType] = key.split('|') as [GraphRelType, string, string]
    involved.add(relatingType)
    involved.add(relatedType)
    edges.push({ id: key, source: relatingType, target: relatedType, relType, count })
  }

  const nodes: TypeGraphNode[] = Array.from(involved).map((t) => ({
    id: t,
    entityType: t,
    count: entityTypeCounts.get(t) ?? 0,
  }))

  post({ type: 'graphOverviewData', payload: { nodes, edges } })
}

/* ==================== Inspecteur IFC ==================== */

/**
 * Index « expressId → position dans le fichier » construit en un seul passage
 * sur les octets. Une ligne STEP commence par `#id=` en début de ligne ; son
 * texte n'est décodé qu'à la demande, pour ne pas garder 2× le fichier en
 * mémoire sous forme de chaîne.
 */
function buildLineIndex() {
  lineIndex.clear()
  if (!fileBytes) return
  const b = fileBytes
  const n = b.length
  let i = 0
  while (i < n) {
    // Début de ligne : saute les blancs puis attend '#'.
    while (i < n && (b[i] === 32 || b[i] === 9 || b[i] === 13 || b[i] === 10)) i++
    if (i < n && b[i] === 35) {
      let j = i + 1
      let id = 0
      let digits = 0
      while (j < n && b[j] >= 48 && b[j] <= 57) { id = id * 10 + (b[j] - 48); j++; digits++ }
      while (j < n && (b[j] === 32 || b[j] === 9)) j++
      if (digits > 0 && b[j] === 61) lineIndex.set(id, i)
    }
    // Avance jusqu'à la fin de l'instruction (';' hors chaîne), puis à la ligne suivante.
    let inStr = false
    while (i < n) {
      const c = b[i]
      if (c === 39) inStr = !inStr
      else if (c === 59 && !inStr) { i++; break }
      i++
    }
  }
}

const decoder = new TextDecoder('utf-8', { fatal: false })

/** Texte brut d'une instruction STEP, de `#id=` au `;` inclus, sur une seule ligne. */
function rawLine(id: number): string | null {
  if (!fileBytes) return null
  const start = lineIndex.get(id)
  if (start === undefined) return null
  const b = fileBytes
  let inStr = false
  let i = start
  while (i < b.length) {
    const c = b[i]
    if (c === 39) inStr = !inStr
    else if (c === 59 && !inStr) break
    i++
  }
  return decoder.decode(b.subarray(start, i + 1)).replace(/\s*[\r\n]+\s*/g, ' ')
}

/** Lignes d'en-tête (FILE_DESCRIPTION, FILE_NAME, FILE_SCHEMA), hors section DATA. */
function rawHeaderLine(name: string): string | null {
  if (!fileBytes) return null
  const head = decoder.decode(fileBytes.subarray(0, Math.min(fileBytes.length, 8192)))
  const m = head.match(new RegExp(`${name}\\s*\\(([\\s\\S]*?)\\)\\s*;`))
  return m ? `${name}(${m[1]});`.replace(/\s*[\r\n]+\s*/g, ' ') : null
}

/** Découpe « #id=ENTITY(a,b,(c,d),'e');» en en-tête et arguments de premier niveau. */
function splitStepLine(line: string): { head: string; args: string[] } | null {
  const open = line.indexOf('(')
  const close = line.lastIndexOf(')')
  if (open < 0 || close < open) return null
  const body = line.slice(open + 1, close)
  const args: string[] = []
  let depth = 0
  let inStr = false
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === "'") inStr = !inStr
    else if (inStr) continue
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) {
      args.push(body.slice(start, i))
      start = i + 1
    }
  }
  args.push(body.slice(start))
  return { head: line.slice(0, open), args }
}

function refsIn(text: string): number[] | undefined {
  if (text.includes("'")) return undefined
  const out: number[] = []
  const re = /#(\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push(Number(m[1]))
  return out.length ? out : undefined
}

/** Noms d'attributs dans l'ordre STEP, tels que web-ifc les expose (y compris les dérivés `*`). */
function attrNames(id: number): string[] {
  if (!api) return []
  try {
    const line = api.GetLine(modelId, id, false) as Record<string, unknown>
    return Object.keys(line).filter((k) => k !== 'expressID' && k !== 'type')
  } catch {
    return []
  }
}

/**
 * Construit une ligne de l'inspecteur : texte brut découpé, nom de chaque
 * attribut, références cliquables et clés de mise en évidence (`keys` :
 * nom d'attribut → clé).
 */
function inspectLine(id: number, opts: { note?: string; keys?: Record<string, string> } = {}): InspectLine | null {
  const raw = rawLine(id)
  const parts = raw ? splitStepLine(raw) : null
  if (!parts) return null
  const names = attrNames(id)
  const eq = parts.head.indexOf('=')
  const typeName = parts.head.slice(eq + 1).trim()
  const args: InspectArg[] = parts.args.map((text, i) => {
    const name = names[i]
    const key = name && opts.keys ? opts.keys[name] : undefined
    const refs = refsIn(text)
    const a: InspectArg = { text }
    if (name) a.name = name
    if (refs) a.refs = refs
    if (key) a.key = key
    return a
  })
  return { id, typeName, args, note: opts.note }
}

function headerLine(name: string, keys: Record<number, string> = {}, note?: string): InspectLine | null {
  const raw = rawHeaderLine(name)
  const parts = raw ? splitStepLine(raw) : null
  if (!parts) return null
  return {
    id: 0,
    typeName: name,
    note,
    args: parts.args.map((text, i) => (keys[i] ? { text, key: keys[i] } : { text })),
  }
}

function groupOf(title: string, lines: (InspectLine | null)[]): InspectGroup | null {
  const ok = lines.filter((l): l is InspectLine => l !== null)
  return ok.length ? { title, lines: ok } : null
}

function compact(groups: (InspectGroup | null)[]): InspectGroup[] {
  return groups.filter((g): g is InspectGroup => g !== null)
}

function firstId(type: number): number | null {
  if (!api) return null
  try {
    const ids = api.GetLineIDsWithType(modelId, type)
    return ids.size() > 0 ? ids.get(0) : null
  } catch {
    return null
  }
}

function lineOf(id: number | null): Record<string, unknown> | null {
  if (!api || id === null) return null
  try {
    return api.GetLine(modelId, id, false) as Record<string, unknown>
  } catch {
    return null
  }
}

function refId(raw: unknown): number | null {
  const r = raw as Record<string, unknown> | undefined
  return r && typeof r.value === 'number' ? (r.value as number) : null
}

function typeNameOf(id: number): string {
  return getEntityType(id) ?? 'Inconnu'
}

/** Chaîne [#a, #b, #c] rendue en un groupe, avec mise en évidence d'un attribut. */
function chainGroups(ids: number[], focusId?: number, focusAttr?: string, title = 'Lignes liées'): InspectGroup[] {
  const seen = new Set<number>()
  const lines = ids
    .filter((id) => (seen.has(id) ? false : (seen.add(id), true)))
    .map((id) => inspectLine(id, id === focusId && focusAttr ? { keys: { [focusAttr]: 'focus' } } : {}))
  return compact([groupOf(title, lines)])
}

/* ---- Géolocalisation / géoréférencement ---- */

function geoGroups(): InspectGroup[] {
  const siteId = firstId(WebIFC.IFCSITE)
  const site = lineOf(siteId)

  const groups: (InspectGroup | null)[] = []
  groups.push(groupOf('Géolocalisation — IfcSite', [
    siteId === null ? null : inspectLine(siteId, {
      note: 'Site : latitude, longitude, altitude de référence',
      keys: { RefLatitude: 'geo.latitude', RefLongitude: 'geo.longitude', RefElevation: 'geo.elevation', ObjectPlacement: 'site.position' },
    }),
  ]))

  let mcId: number | null = null
  let crsId: number | null = null
  try { mcId = firstId(WebIFC.IFCMAPCONVERSION) } catch { /* schéma sans l'entité */ }
  if (mcId !== null) crsId = refId(lineOf(mcId)!.TargetCRS)
  else { try { crsId = firstId(WebIFC.IFCPROJECTEDCRS) } catch { /* idem */ } }
  const crs = lineOf(crsId)
  const unitId = crs ? refId(crs.MapUnit) : null
  groups.push(groupOf('Système de coordonnées — IfcProjectedCRS', [
    crsId === null ? null : inspectLine(crsId, {
      note: 'Nom, description, datum géodésique, datum vertical, projection, zone, unité',
      keys: {
        Name: 'crs.name', Description: 'crs.description', GeodeticDatum: 'crs.geodeticDatum',
        VerticalDatum: 'crs.verticalDatum', MapProjection: 'crs.mapProjection', MapZone: 'crs.mapZone', MapUnit: 'crs.mapUnit',
      },
    }),
    unitId === null ? null : inspectLine(unitId, { note: 'Unité du système de coordonnées', keys: { Prefix: 'crs.mapUnit', Name: 'crs.mapUnit' } }),
  ]))
  groups.push(groupOf('Conversion — IfcMapConversion', [
    mcId === null ? null : inspectLine(mcId, {
      note: 'Eastings, Northings, OrthogonalHeight, XAxisAbscissa, XAxisOrdinate, Scale',
      keys: {
        Eastings: 'mc.eastings', Northings: 'mc.northings', OrthogonalHeight: 'mc.orthogonalHeight',
        XAxisAbscissa: 'mc.rotation', XAxisOrdinate: 'mc.rotation', Scale: 'mc.scale',
      },
    }),
  ]))

  const chain: (InspectLine | null)[] = []
  let plId = site ? refId(site.ObjectPlacement) : null
  for (let depth = 0; plId !== null && depth < 32; depth++) {
    const pl = lineOf(plId)
    if (!pl) break
    chain.push(inspectLine(plId, { note: depth === 0 ? 'Placement du site' : 'Placement parent' }))
    const axId = refId(pl.RelativePlacement)
    const ax = lineOf(axId)
    if (ax) {
      chain.push(inspectLine(axId!, { note: 'Repère : origine, axe Z, direction X' }))
      const loc = refId(ax.Location)
      const dir = refId(ax.RefDirection)
      if (loc !== null) chain.push(inspectLine(loc, { note: 'Origine du site (X, Y, Z)', keys: { Coordinates: 'site.position' } }))
      if (dir !== null) chain.push(inspectLine(dir, { note: 'Orientation (direction X)', keys: { DirectionRatios: 'site.orientation' } }))
    }
    plId = refId(pl.PlacementRelTo)
  }
  groups.push(groupOf('Position du site — IfcLocalPlacement', chain))

  const ctxIds = api!.GetLineIDsWithType(modelId, WebIFC.IFCGEOMETRICREPRESENTATIONCONTEXT)
  for (let i = 0; i < ctxIds.size(); i++) {
    const ctx = lineOf(ctxIds.get(i))
    if (!ctx?.TrueNorth) continue
    const tn = refId(ctx.TrueNorth)
    groups.push(groupOf('Nord vrai — IfcGeometricRepresentationContext', [
      inspectLine(ctxIds.get(i), { note: 'Contexte géométrique du modèle', keys: { TrueNorth: 'trueNorth' } }),
      tn === null ? null : inspectLine(tn, { note: 'Direction du Nord vrai', keys: { DirectionRatios: 'trueNorth' } }),
    ]))
    break
  }
  return compact(groups)
}

/* ---- Champs de l'onglet Infos projet ---- */

const PROJECT_FIELD_LABEL: Record<string, string> = {
  'project.Name': 'Nom du projet',
  'project.LongName': 'Désignation du projet',
  'project.Phase': 'Phase',
  'project.Description': 'Description du projet',
  'building.Name': 'Bâtiment',
  'site.Name': 'Nom du site',
  'site.Address': 'Adresse du site',
  schema: 'Schéma IFC',
  mvd: 'MVD (Model View Definition)',
  'owner.application': 'Application',
  'owner.version': 'Version de l’application',
  'owner.developer': 'Éditeur',
  'owner.person': 'Auteur',
  'owner.organization': 'Organisation',
  'owner.creationDate': 'Date de création',
  'owner.lastModifiedDate': 'Date de modification',
  storey: 'Étage',
  unit: 'Unité',
}

function projectFieldResult(field: string, id: number | undefined): Omit<InspectResult, 'request'> {
  const title = PROJECT_FIELD_LABEL[field] ?? field
  const family: InspectFamily = 'project'

  if (field === 'schema' || field === 'mvd') {
    return {
      family, title,
      subtitle: 'En-tête STEP du fichier (section HEADER)',
      focusKey: 'focus',
      groups: compact([groupOf('En-tête du fichier', [
        headerLine('FILE_DESCRIPTION', field === 'mvd' ? { 0: 'focus' } : {}, 'Description : MVD, niveau d’implémentation'),
        headerLine('FILE_NAME', {}, 'Nom, horodatage, auteur, organisation, préprocesseur, logiciel d’origine'),
        headerLine('FILE_SCHEMA', field === 'schema' ? { 0: 'focus' } : {}, 'Schéma IFC déclaré'),
      ])]),
    }
  }

  const [scope, attr] = field.split('.')
  if (scope === 'project' || scope === 'building' || scope === 'site') {
    const type = scope === 'project' ? WebIFC.IFCPROJECT : scope === 'building' ? WebIFC.IFCBUILDING : WebIFC.IFCSITE
    const eid = firstId(type)
    if (eid === null) return { family, title, groups: [] }
    if (attr === 'Address') {
      const line = lineOf(eid)
      const addrId = line ? refId(line.SiteAddress ?? line.BuildingAddress) : null
      return {
        family, title, focusKey: 'focus',
        groups: compact([groupOf('Adresse', [
          inspectLine(eid, { keys: { SiteAddress: 'ref', BuildingAddress: 'ref' } }),
          addrId === null ? null : inspectLine(addrId, { note: 'Adresse postale', keys: { AddressLines: 'focus', Town: 'focus', Region: 'focus', PostalCode: 'focus', Country: 'focus' } }),
        ])]),
      }
    }
    return { family, title, focusKey: 'focus', groups: chainGroups([eid], eid, attr, 'Entité') }
  }

  if (scope === 'owner') {
    const ohId = firstId(WebIFC.IFCOWNERHISTORY)
    const oh = lineOf(ohId)
    if (!oh || ohId === null) return { family, title, groups: [] }
    const puId = refId(oh.OwningUser)
    const pu = lineOf(puId)
    const personId = pu ? refId(pu.ThePerson) : null
    const orgId = pu ? refId(pu.TheOrganization) : null
    const appId = refId(oh.OwningApplication)
    const app = lineOf(appId)
    const devId = app ? refId(app.ApplicationDeveloper) : null
    const k = (cond: boolean, keys: Record<string, string>) => (cond ? keys : {})
    return {
      family, title, focusKey: 'focus',
      groups: compact([
        groupOf('Historique — IfcOwnerHistory', [
          inspectLine(ohId, {
            note: 'Utilisateur, application, état, action, dates',
            keys: { ...k(attr === 'creationDate', { CreationDate: 'focus' }), ...k(attr === 'lastModifiedDate', { LastModifiedDate: 'focus' }) },
          }),
        ]),
        groupOf('Auteur — IfcPersonAndOrganization', [
          puId === null ? null : inspectLine(puId, { note: 'Personne + organisation' }),
          personId === null ? null : inspectLine(personId, { note: 'Personne', keys: k(attr === 'person', { FamilyName: 'focus', GivenName: 'focus' }) }),
          orgId === null ? null : inspectLine(orgId, { note: 'Organisation', keys: k(attr === 'organization', { Name: 'focus' }) }),
        ]),
        groupOf('Logiciel — IfcApplication', [
          appId === null ? null : inspectLine(appId, {
            note: 'Éditeur, version, nom complet, identifiant',
            keys: { ...k(attr === 'application', { ApplicationFullName: 'focus', ApplicationIdentifier: 'focus' }), ...k(attr === 'version', { Version: 'focus' }) },
          }),
          devId === null ? null : inspectLine(devId, { note: 'Éditeur', keys: k(attr === 'developer', { Name: 'focus' }) }),
        ]),
      ]),
    }
  }

  if ((scope === 'storey' || scope === 'unit') && id !== undefined) {
    const keys: Record<string, string> = scope === 'storey' ? { Name: 'focus', Elevation: 'focus' } : { UnitType: 'focus', Prefix: 'focus', Name: 'focus', ConversionFactor: 'focus', Currency: 'focus' }
    const line = lineOf(id)
    const extra: (InspectLine | null)[] = []
    if (scope === 'unit' && line) {
      const cf = refId(line.ConversionFactor)
      const cfLine = lineOf(cf)
      if (cf !== null) extra.push(inspectLine(cf, { note: 'Facteur de conversion (valeur, unité SI)' }))
      const base = cfLine ? refId(cfLine.UnitComponent) : null
      if (base !== null) extra.push(inspectLine(base, { note: 'Unité SI de référence' }))
    }
    return {
      family, title: `${title} — ${safeStr(line?.Name) ?? `#${id}`}`, focusKey: 'focus',
      groups: compact([groupOf(scope === 'storey' ? 'Étage — IfcBuildingStorey' : 'Unité', [inspectLine(id, { keys }), ...extra])]),
    }
  }

  return { family, title, groups: [] }
}

/* ---- Attributs et propriétés agrégés ---- */

const OCCURRENCE_CAP = 300

function occurrenceLabel(line: Record<string, unknown> | null): string | null {
  if (!line) return null
  return safeStr(line.Name) ?? safeStr(line.GlobalId)
}

function attributeResult(entityType: string, attr: string, value?: string): Omit<InspectResult, 'request'> {
  const typeCode = typeCodeMap.get(entityType)
  const items: InspectOccurrence[] = []
  let total = 0
  if (api && typeCode !== undefined) {
    const ids = api.GetLineIDsWithType(modelId, typeCode)
    for (let i = 0; i < ids.size(); i++) {
      const id = ids.get(i)
      const line = lineOf(id)
      if (!line) continue
      const v = valueToString(line[attr])
      if (v === null || v === '') continue
      const str = String(v)
      if (value !== undefined && str !== value) continue
      total++
      if (items.length < OCCURRENCE_CAP) {
        items.push({ id, typeName: entityType, label: occurrenceLabel(line), value: str, chain: [id], focusId: id, focusAttr: attr })
      }
    }
  }
  const first = items[0]
  return {
    family: 'attribute',
    title: `${entityType} · ${attr}${value !== undefined ? ` = ${value}` : ''}`,
    subtitle: `${total.toLocaleString('fr-FR')} occurrence${total > 1 ? 's' : ''} portant cet attribut`,
    focusKey: 'focus',
    groups: first ? chainGroups(first.chain, first.focusId, first.focusAttr, 'Première occurrence') : [],
    occurrences: { total, items },
  }
}

function propertyResult(entityType: string, psetName: string, propName?: string, value?: string): Omit<InspectResult, 'request'> {
  const typeCode = typeCodeMap.get(entityType)
  const items: InspectOccurrence[] = []
  let total = 0
  if (api && typeCode !== undefined) {
    const ids = api.GetLineIDsWithType(modelId, typeCode)
    for (let i = 0; i < ids.size(); i++) {
      const id = ids.get(i)
      const psets = entityPsetMap.get(id) ?? []
      for (const pset of psets) {
        if (pset.name !== psetName || pset.id === undefined) continue
        if (propName === undefined) {
          total++
          if (items.length < OCCURRENCE_CAP) {
            items.push({
              id, typeName: entityType, label: occurrenceLabel(lineOf(id)), value: null,
              chain: [id, ...(pset.relId !== undefined ? [pset.relId] : []), pset.id], focusId: pset.id, focusAttr: 'Name',
            })
          }
          continue
        }
        for (const prop of pset.properties) {
          if (prop.name !== propName || prop.id === undefined) continue
          if (prop.value === null || prop.value === '') continue
          const str = String(prop.value)
          if (value !== undefined && str !== value) continue
          total++
          if (items.length < OCCURRENCE_CAP) {
            items.push({
              id, typeName: entityType, label: occurrenceLabel(lineOf(id)), value: str,
              chain: [id, ...(pset.relId !== undefined ? [pset.relId] : []), pset.id, prop.id], focusId: prop.id, focusAttr: prop.valueAttr,
            })
          }
        }
      }
    }
  }
  const first = items[0]
  return {
    family: 'property',
    title: `${entityType} · ${psetName}${propName ? ` · ${propName}` : ''}${value !== undefined ? ` = ${value}` : ''}`,
    subtitle: `${total.toLocaleString('fr-FR')} occurrence${total > 1 ? 's' : ''} — élément → IfcRelDefinesByProperties → ${propName ? 'Pset → propriété' : 'Pset'}`,
    focusKey: 'focus',
    groups: first ? chainGroups(first.chain, first.focusId, first.focusAttr, 'Première occurrence') : [],
    occurrences: { total, items },
  }
}

/* ---- Graphe ---- */

function memberIdsOf(nodeId: string | undefined, entityType: string): number[] {
  if (nodeId?.startsWith('e')) return [Number(nodeId.slice(1))]
  if (nodeId && groupMembers.has(nodeId)) return groupMembers.get(nodeId)!
  const typeCode = typeCodeMap.get(entityType)
  if (!api || typeCode === undefined) return []
  const ids = api.GetLineIDsWithType(modelId, typeCode)
  const out: number[] = []
  for (let i = 0; i < ids.size(); i++) out.push(ids.get(i))
  return out
}

function instancesResult(entityType: string, nodeId?: string): Omit<InspectResult, 'request'> {
  const ids = memberIdsOf(nodeId, entityType)
  const items: InspectOccurrence[] = ids.slice(0, OCCURRENCE_CAP).map((id) => ({
    id, typeName: typeNameOf(id), label: occurrenceLabel(lineOf(id)), value: null, chain: [id], focusId: id, focusAttr: 'Name',
  }))
  const first = items[0]
  return {
    family: 'entity',
    title: ids.length === 1 ? `${typeNameOf(ids[0])} #${ids[0]}` : `${entityType} — ${ids.length.toLocaleString('fr-FR')} instance${ids.length > 1 ? 's' : ''}`,
    subtitle: ids.length === 1 ? (safeStr(lineOf(ids[0])?.GlobalId) ? `GUID ${safeStr(lineOf(ids[0])?.GlobalId)}` : undefined) : undefined,
    focusKey: 'focus',
    groups: first ? chainGroups(first.chain, first.focusId, first.focusAttr, ids.length === 1 ? 'Entité' : 'Première instance') : [],
    occurrences: ids.length > 1 ? { total: ids.length, items } : undefined,
  }
}

function relationsResult(relType: GraphRelType, nodeId?: string, sourceType?: string, targetType?: string): Omit<InspectResult, 'request'> {
  buildRelationIndex([relType])
  const seen = new Set<number>()
  const items: InspectOccurrence[] = []
  let total = 0
  const take = (r: RawRel) => {
    if (r.relType !== relType || seen.has(r.relId)) return
    seen.add(r.relId)
    total++
    if (items.length < OCCURRENCE_CAP) {
      items.push({
        id: r.relId, typeName: relType,
        label: `${typeNameOf(r.relatingId)} #${r.relatingId} → ${typeNameOf(r.relatedId)} #${r.relatedId}`,
        value: r.relGlobalId, chain: [r.relId, r.relatingId, r.relatedId], focusId: r.relId,
      })
    }
  }
  if (nodeId) {
    const entityType = nodeId.startsWith('g:') ? nodeId.split(':').pop()! : ''
    for (const id of memberIdsOf(nodeId, entityType)) {
      for (const r of outRels.get(id) ?? []) take(r)
      for (const r of inRels.get(id) ?? []) take(r)
    }
  } else {
    for (const rels of outRels.values()) {
      for (const r of rels) {
        if (r.relType !== relType) continue
        if (sourceType && getEntityType(r.relatingId) !== sourceType) continue
        if (targetType && getEntityType(r.relatedId) !== targetType) continue
        take(r)
      }
    }
  }
  const first = items[0]
  return {
    family: 'relation',
    title: `${relType}${sourceType || targetType ? ` · ${sourceType ?? '…'} → ${targetType ?? '…'}` : ''}`,
    subtitle: `${total.toLocaleString('fr-FR')} relation${total > 1 ? 's' : ''} — ligne IfcRel, puis entité relating et entité related`,
    focusKey: 'focus',
    groups: first ? relationGroups(first.chain, relType) : [],
    occurrences: { total, items },
  }
}

/** Ligne IfcRel… avec ses deux extrémités mises en évidence, puis les entités relating et related. */
function relationGroups(chain: number[], relType: GraphRelType): InspectGroup[] {
  const { relating, related } = REL_ATTRS[relType]
  const [relId, relatingId, relatedId] = chain
  return compact([
    groupOf('Relation', [inspectLine(relId, { note: `${relating} → ${related}`, keys: { [relating]: 'focus', [related]: 'focus' } })]),
    groupOf('Extrémités', [
      relatingId === undefined ? null : inspectLine(relatingId, { note: `Relating (${relating})` }),
      relatedId === undefined ? null : inspectLine(relatedId, { note: `Related (${related})` }),
    ]),
  ])
}

const GEO_KEY_LABEL: Record<string, string> = {
  'geo.latitude': 'Latitude', 'geo.longitude': 'Longitude', 'geo.elevation': 'Altitude (RefElevation)',
  'crs.name': 'Système', 'crs.description': 'Description', 'crs.geodeticDatum': 'Datum géodésique',
  'crs.verticalDatum': 'Datum vertical', 'crs.mapProjection': 'Projection', 'crs.mapZone': 'Zone', 'crs.mapUnit': 'Unité',
  'site.position': 'Position du site (X, Y, Z)', 'site.orientation': 'Orientation du site',
  'mc.eastings': 'Eastings (X)', 'mc.northings': 'Northings (Y)', 'mc.orthogonalHeight': 'Hauteur orthogonale (Z)',
  'mc.rotation': 'Rotation', 'mc.scale': 'Échelle', trueNorth: 'Nord vrai',
}

function inspect(request: InspectRequest): InspectResult {
  if (!api || modelId < 0) return { request, family: 'entity', title: 'Aucun fichier chargé', groups: [] }
  switch (request.kind) {
    case 'geo':
      return {
        request,
        family: request.key.startsWith('geo.') ? 'geolocation' : 'georeference',
        title: GEO_KEY_LABEL[request.key] ?? request.key,
        subtitle: 'Géolocalisation (IfcSite) et géoréférencement (CRS, conversion, placement, Nord vrai)',
        focusKey: request.key,
        groups: geoGroups(),
      }
    case 'project':
      return { request, ...projectFieldResult(request.field, request.id) }
    case 'entity': {
      const line = lineOf(request.id)
      return {
        request, family: 'entity',
        title: `${typeNameOf(request.id)} #${request.id}`,
        subtitle: safeStr(line?.Name) ?? safeStr(line?.GlobalId) ?? undefined,
        focusKey: 'focus',
        groups: chainGroups([request.id], request.id, request.focusAttr, 'Entité'),
      }
    }
    case 'chain': {
      const relType = GRAPH_REL_TYPES.find((t) => t === typeNameOf(request.ids[0]))
      return {
        request, family: relType ? 'relation' : 'entity',
        title: request.ids.map((id) => `#${id}`).join(' → '),
        focusKey: 'focus',
        groups: relType ? relationGroups(request.ids, relType) : chainGroups(request.ids, request.focusId, request.focusAttr),
      }
    }
    case 'attribute':
      return { request, ...attributeResult(request.entityType, request.attr, request.value) }
    case 'property':
      return { request, ...propertyResult(request.entityType, request.pset, request.prop, request.value) }
    case 'instances':
      return { request, ...instancesResult(request.entityType, request.nodeId) }
    case 'relations':
      return { request, ...relationsResult(request.relType, request.nodeId, request.sourceType, request.targetType) }
  }
}

self.onmessage = async (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data
  try {
    if (msg.type === 'init') {
      wasmBasePath = msg.wasmPath
    } else if (msg.type === 'load') {
      await loadFile(msg.buffer)
    } else if (msg.type === 'select') {
      await selectEntityType(msg.entityType)
    } else if (msg.type === 'search') {
      searchGlobal(msg.query)
    } else if (msg.type === 'graphOpenType') {
      graphOpenType(msg.entityType, msg.relTypes)
    } else if (msg.type === 'graphExpand') {
      graphExpand(msg.nodeId, msg.relTypes)
    } else if (msg.type === 'graphOverview') {
      graphOverview()
    } else if (msg.type === 'inspect') {
      post({ type: 'inspectResult', result: inspect(msg.request), token: msg.token })
    }
  } catch (err) {
    post({ type: 'error', message: String(err) })
  }
}
