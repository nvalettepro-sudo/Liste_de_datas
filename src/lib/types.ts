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

/* ---------- Vue graphe (v2) ---------- */

/** Relations IFC exposées dans la vue graphe. Sens : Relating → Related. */
export const GRAPH_REL_TYPES = [
  'IfcRelAssociatesMaterial',
  'IfcRelAssociatesClassification',
  'IfcRelDefinesByType',
  'IfcRelContainedInSpatialStructure',
  'IfcRelAggregates',
  'IfcRelDefinesByProperties',
] as const

export type GraphRelType = (typeof GRAPH_REL_TYPES)[number]

/** IfcRelDefinesByProperties est hors index par défaut (volumétrie). */
export const DEFAULT_REL_TYPES: GraphRelType[] = [
  'IfcRelAssociatesMaterial',
  'IfcRelAssociatesClassification',
  'IfcRelDefinesByType',
  'IfcRelContainedInSpatialStructure',
  'IfcRelAggregates',
]

export type GraphNodeKind = 'occurrence' | 'definition' | 'spatial' | 'group'

export interface GraphNode {
  /** `e<expressId>` pour une entité, `g:<ownerId>:<IfcType>` pour un nœud groupé. */
  id: string
  kind: GraphNodeKind
  entityType: string
  label: string
  expressId?: number
  globalId?: string | null
  /** Nœuds groupés uniquement : nombre d'occurrences représentées. */
  count?: number
  /** Vrai si le nœud possède des relations non encore affichées. */
  expandable: boolean
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  relType: GraphRelType
  /** Nombre de relations IFC réelles agrégées par cette arête. */
  count: number
  /** GUID de la relation, seulement quand l'arête n'en agrège qu'une. */
  relGlobalId?: string | null
}

export interface GraphPayload {
  /** Nœud à partir duquel l'expansion a été demandée. */
  originId: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Vrai si des voisins ont été omis pour respecter la limite de rendu. */
  truncated: boolean
  omittedCount: number
}

/**
 * Vue d'ensemble (v2.1) : le graphe complet de la maquette, à la maille
 * "type d'entité IFC" plutôt qu'instance. Un nœud par type présent dans le
 * fichier, une arête par relation IFC officielle reliant deux types, avec le
 * nombre réel d'occurrences de cette relation. Toujours calculé sur les 6
 * relations du scope — à ce grain, IfcRelDefinesByProperties ne coûte que
 * quelques arêtes de plus, pas une explosion d'instances.
 */
export interface TypeGraphNode {
  /** Égal à `entityType` — uniformise l'interface avec GraphNode. */
  id: string
  entityType: string
  count: number
}

export interface TypeGraphEdge {
  id: string
  source: string
  target: string
  relType: GraphRelType
  count: number
}

export interface TypeGraphPayload {
  nodes: TypeGraphNode[]
  edges: TypeGraphEdge[]
}

/* ---------- Informations projet / site ---------- */

export interface UnitInfo {
  /** Valeur de IfcUnitEnum (LENGTHUNIT, AREAUNIT…) ou 'MONETARYUNIT'. */
  unitType: string
  label: string
}

export interface StoreyInfo {
  name: string | null
  elevation: number | null
}

export interface MapConversionInfo {
  eastings: number | null
  northings: number | null
  orthogonalHeight: number | null
  /** Dérivée de XAxisAbscissa/XAxisOrdinate, en degrés. */
  rotation: number | null
  scale: number | null
  crsName: string | null
  crsDescription: string | null
  geodeticDatum: string | null
  verticalDatum: string | null
  mapProjection: string | null
  mapZone: string | null
}

export interface GeoReference {
  /** IfcSite.RefLatitude/RefLongitude convertis en degrés décimaux (2x3 et 4+). */
  latitude: number | null
  longitude: number | null
  elevation: number | null
  /** IFC4+ uniquement : conversion vers un système de coordonnées projeté (IfcMapConversion). */
  mapConversion: MapConversionInfo | null
}

export interface OwnerHistoryInfo {
  creationDate: string | null
  lastModifiedDate: string | null
  personName: string | null
  organizationName: string | null
  applicationName: string | null
  applicationVersion: string | null
  applicationDeveloper: string | null
}

export interface ProjectInfo {
  schema: string
  /** Model View Definition, extrait de l'en-tête STEP (FILE_DESCRIPTION). */
  mvd: string | null
  projectName: string | null
  projectLongName: string | null
  projectPhase: string | null
  siteName: string | null
  siteAddress: string | null
  buildingName: string | null
  storeys: StoreyInfo[]
  georeference: GeoReference | null
  ownerHistory: OwnerHistoryInfo | null
  units: UnitInfo[]
}

export type WorkerInMessage =
  | { type: 'init'; wasmPath: string }
  | { type: 'load'; buffer: ArrayBuffer }
  | { type: 'select'; entityType: string }
  | { type: 'search'; query: string }
  | { type: 'graphOpenType'; entityType: string; relTypes: GraphRelType[] }
  | { type: 'graphExpand'; nodeId: string; relTypes: GraphRelType[] }
  | { type: 'graphOverview' }

export type WorkerOutMessage =
  | { type: 'progress'; percent: number; phase: string }
  | { type: 'ready'; entityTypes: EntityTypeSummary[]; ifcVersion: string }
  | { type: 'projectInfo'; data: ProjectInfo }
  | { type: 'aggregated'; data: AggregatedEntityData }
  | { type: 'searchResults'; query: string; results: GlobalSearchResult[] }
  | { type: 'graphData'; payload: GraphPayload }
  | { type: 'graphOverviewData'; payload: TypeGraphPayload }
  | { type: 'error'; message: string }
