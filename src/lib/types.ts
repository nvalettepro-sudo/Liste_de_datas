export interface PropertyEntry {
  name: string
  value: string | number | boolean | null
  unit?: string
}

export interface PsetData {
  name: string
  isStandard: boolean
  properties: PropertyEntry[]
}

export interface IfcEntity {
  expressId: number
  type: string
  name: string | null
  globalId: string | null
  predefinedType: string | null
  storey: string | null
  attributes: Record<string, string | number | boolean | null>
  psets: PsetData[]
}

export interface EntityTypeSummary {
  type: string
  count: number
  storeyBreakdown: Record<string, number>
}

export interface TextValueCount {
  value: string
  count: number
}

export interface ValueAggregate {
  kind: 'text' | 'numeric' | 'empty'
  distinctValues?: TextValueCount[]
  min?: number
  max?: number
  presentCount: number
  totalCount: number
}

export interface AggregatedProperty {
  name: string
  aggregate: ValueAggregate
}

export interface AggregatedPset {
  name: string
  isStandard: boolean
  presentCount: number
  totalCount: number
  properties: AggregatedProperty[]
}

export interface AggregatedEntityData {
  entityType: string
  totalCount: number
  attributes: AggregatedProperty[]
  standardPsets: AggregatedPset[]
  customPsets: AggregatedPset[]
}

export interface GlobalSearchMatch {
  matchType: 'pset' | 'property' | 'value'
  psetName: string
  propertyName?: string
  occurrences: number
}

export interface GlobalSearchResult {
  entityType: string
  totalCount: number
  matchingCount: number
  matches: GlobalSearchMatch[]
}

export type WorkerInMessage =
  | { type: 'init'; wasmPath: string }
  | { type: 'load'; buffer: ArrayBuffer }
  | { type: 'select'; entityType: string }
  | { type: 'search'; query: string }

export type WorkerOutMessage =
  | { type: 'progress'; percent: number; phase: string }
  | { type: 'ready'; entityTypes: EntityTypeSummary[]; ifcVersion: string }
  | { type: 'aggregated'; data: AggregatedEntityData }
  | { type: 'searchResults'; query: string; results: GlobalSearchResult[] }
  | { type: 'error'; message: string }
