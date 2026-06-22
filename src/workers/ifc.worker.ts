import * as WebIFC from 'web-ifc'
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
  WorkerInMessage,
  WorkerOutMessage,
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
    typeSummaries.push({ type: typeName, count, storeyBreakdown: {} })

    if (i % 50 === 0) {
      const pct = 60 + Math.round((i / allTypes.length) * 30)
      post({ type: 'progress', percent: pct, phase: `Types… (${i}/${allTypes.length})` })
    }
  }

  typeSummaries.sort((a, b) => b.count - a.count)

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
    }
  } catch (err) {
    post({ type: 'error', message: String(err) })
  }
}
