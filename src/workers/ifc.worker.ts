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

      properties.push({ name: propName, value: propValue, unit })
    }
  }

  return { name: psetName, isStandard, properties }
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
function compoundAngleToDecimal(raw: unknown): number | null {
  const wrapped = raw as Record<string, unknown> | undefined
  const list = Array.isArray(raw) ? raw : Array.isArray(wrapped?.value) ? wrapped!.value : null
  if (!Array.isArray(list) || list.length === 0) return null
  const parts = list.map((v) => numOf(v) ?? 0)
  const [deg, min = 0, sec = 0, micro = 0] = parts
  const sign = deg < 0 ? -1 : 1
  return sign * (Math.abs(deg) + min / 60 + sec / 3600 + micro / 3_600_000_000)
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
    storeys.push({ name: safeStr(line.Name), elevation: numOf(line.Elevation) })
  }
  storeys.sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0))
  return storeys
}

/**
 * Géoréférencement : IfcSite porte les coordonnées WGS84 dans toutes les
 * versions ; IfcMapConversion/IfcProjectedCRS (conversion vers un système
 * projeté) n'existe qu'à partir d'IFC4.
 */
function buildGeoreference(schema: string): GeoReference | null {
  if (!api) return null

  let latitude: number | null = null
  let longitude: number | null = null
  let elevation: number | null = null
  const siteIds = api.GetLineIDsWithType(modelId, WebIFC.IFCSITE)
  if (siteIds.size() > 0) {
    const site = api.GetLine(modelId, siteIds.get(0), false) as Record<string, unknown>
    latitude = compoundAngleToDecimal(site.RefLatitude)
    longitude = compoundAngleToDecimal(site.RefLongitude)
    elevation = numOf(site.RefElevation)
  }

  let mapConversion: GeoReference['mapConversion'] = null
  if (schema !== 'IFC2X3') {
    const mcIds = api.GetLineIDsWithType(modelId, WebIFC.IFCMAPCONVERSION)
    if (mcIds.size() > 0) {
      const mc = api.GetLine(modelId, mcIds.get(0), false) as Record<string, unknown>
      const xAbs = numOf(mc.XAxisAbscissa)
      const xOrd = numOf(mc.XAxisOrdinate)
      const crs = resolveRef(mc.TargetCRS)
      mapConversion = {
        eastings: numOf(mc.Eastings),
        northings: numOf(mc.Northings),
        orthogonalHeight: numOf(mc.OrthogonalHeight),
        rotation: xAbs !== null && xOrd !== null ? (Math.atan2(xOrd, xAbs) * 180) / Math.PI : null,
        scale: numOf(mc.Scale),
        crsName: crs ? safeStr(crs.Name) : null,
        crsDescription: crs ? safeStr(crs.Description) : null,
        geodeticDatum: crs ? safeStr(crs.GeodeticDatum) : null,
        verticalDatum: crs ? safeStr(crs.VerticalDatum) : null,
        mapProjection: crs ? safeStr(crs.MapProjection) : null,
        mapZone: crs ? safeStr(crs.MapZone) : null,
      }
    }
  }

  if (latitude === null && longitude === null && !mapConversion) return null
  return { latitude, longitude, elevation, mapConversion }
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
    units.push({ unitType, label: `${UNIT_TYPE_LABEL[unitType] ?? unitType} : ${symbol}` })
  }

  const cbIds = api.GetLineIDsWithType(modelId, WebIFC.IFCCONVERSIONBASEDUNIT)
  for (let i = 0; i < cbIds.size(); i++) {
    const line = api.GetLine(modelId, cbIds.get(i), false) as Record<string, unknown>
    if (!line) continue
    const unitType = safeStr(line.UnitType) ?? 'USERDEFINED'
    const name = safeStr(line.Name) ?? ''
    units.push({ unitType, label: `${UNIT_TYPE_LABEL[unitType] ?? unitType} : ${name}` })
  }

  const monIds = api.GetLineIDsWithType(modelId, WebIFC.IFCMONETARYUNIT)
  for (let i = 0; i < monIds.size(); i++) {
    const line = api.GetLine(modelId, monIds.get(i), false) as Record<string, unknown>
    if (!line) continue
    const currency = safeStr(line.Currency) ?? 'Devise'
    units.push({ unitType: 'MONETARYUNIT', label: `${UNIT_TYPE_LABEL.MONETARYUNIT} : ${currency}` })
  }

  return units
}

function buildProjectInfo(buffer: ArrayBuffer, schema: string): ProjectInfo {
  const info: ProjectInfo = {
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

  try {
    modelId = api.OpenModel(new Uint8Array(buffer), { COORDINATE_TO_ORIGIN: false })
  } catch (e) {
    post({ type: 'error', message: `Erreur de chargement: ${e}` })
    return
  }

  typeCodeMap.clear()
  entityPsetMap.clear()
  storeyCache.clear()
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
      let rel: Record<string, unknown>
      try {
        rel = api.GetLine(modelId, lineIds.get(i), false) as Record<string, unknown>
      } catch { continue }
      if (!rel) continue

      const relatingIds = refIds(rel[relating])
      const relatedIds = refIds(rel[related])
      if (relatingIds.length === 0 || relatedIds.length === 0) continue

      const relGlobalId = safeStr(rel.GlobalId)

      for (const relatingId of relatingIds) {
        const relatingType = getEntityType(relatingId)
        for (const relatedId of relatedIds) {
          const raw: RawRel = { relType, relGlobalId, relatingId, relatedId }
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
    }
  } catch (err) {
    post({ type: 'error', message: String(err) })
  }
}
