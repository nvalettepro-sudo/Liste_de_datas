export interface PropertyEntry {
  name: string
  value: string | number | boolean | null
  unit?: string
  /** expressId de l'IfcProperty / IfcPhysicalQuantity, pour l'inspecteur. */
  id?: number
  /** Attribut STEP qui porte la valeur (NominalValue, LengthValue…). */
  valueAttr?: string
}

export interface PsetData {
  name: string
  isStandard: boolean
  properties: PropertyEntry[]
  /** expressId de l'IfcPropertySet / IfcElementQuantity. */
  id?: number
  /** expressId de l'IfcRelDefinesByProperties qui le rattache. */
  relId?: number
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
  id: number
  /** Valeur de IfcUnitEnum (LENGTHUNIT, AREAUNIT…) ou 'MONETARYUNIT'. */
  unitType: string
  label: string
}

export interface StoreyInfo {
  id: number
  name: string | null
  elevation: number | null
}

export interface XYZ {
  x: number
  y: number
  z: number
}

/**
 * GÉORÉFÉRENCEMENT : repère de coordonnées projetées (X/Y/Z) du modèle.
 * Distinct de la géolocalisation (latitude/longitude) ci-dessous.
 */
export interface GeoReference {
  /** IfcProjectedCRS — null si le fichier n'en déclare pas. */
  crs: {
    name: string | null
    description: string | null
    geodeticDatum: string | null
    verticalDatum: string | null
    mapProjection: string | null
    mapZone: string | null
    mapUnit: string | null
  } | null
  /** IfcMapConversion (IFC4+) — origine du repère projeté, peut valoir 0/0/0. */
  mapConversion: {
    eastings: number | null
    northings: number | null
    orthogonalHeight: number | null
    /** Dérivée de XAxisAbscissa/XAxisOrdinate, en degrés. */
    rotation: number | null
    scale: number | null
  } | null
  /** Position absolue de l'IfcSite (chaîne d'IfcLocalPlacement composée), dans le repère du modèle. */
  sitePosition: XYZ | null
  /** sitePosition passée dans IfcMapConversion — coordonnées dans le CRS cible. Null sans conversion. */
  projectedPosition: XYZ | null
  /** Angle du Nord vrai (IfcGeometricRepresentationContext.TrueNorth) par rapport à l'axe Y, en degrés. */
  trueNorth: number | null
}

/** GÉOLOCALISATION : coordonnées géographiques de l'IfcSite (latitude/longitude). */
export interface GeoLocation {
  latitude: number | null
  longitude: number | null
  /** Format Solibri : 48°49'24,826450" */
  latitudeDms: string | null
  longitudeDms: string | null
  /** IfcSite.RefElevation */
  elevation: number | null
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
  /** expressIds des entités porteuses, pour ouvrir leur code dans l'inspecteur. */
  ids: { project: number | null; site: number | null; building: number | null; ownerHistory: number | null }
  schema: string
  /** Model View Definition, extrait de l'en-tête STEP (FILE_DESCRIPTION). */
  mvd: string | null
  /** Origine des coordonnées déclarée par Revit dans FILE_DESCRIPTION (« Point de base du projet », « Coordonnées partagées »…). */
  coordinateBase: string | null
  projectName: string | null
  projectLongName: string | null
  projectPhase: string | null
  siteName: string | null
  siteAddress: string | null
  buildingName: string | null
  storeys: StoreyInfo[]
  georeference: GeoReference | null
  geolocation: GeoLocation | null
  ownerHistory: OwnerHistoryInfo | null
  units: UnitInfo[]
}

/* ---------- Inspecteur IFC : pont entre l'application et le code STEP ---------- */

/** Famille d'information, pour la couleur de mise en évidence et la légende. */
export type InspectFamily =
  | 'geolocation'
  | 'georeference'
  | 'project'
  | 'attribute'
  | 'property'
  | 'relation'
  | 'entity'

export interface InspectArg {
  /** Texte STEP brut de l'argument. */
  text: string
  /** Nom d'attribut selon le schéma, quand il est connu. */
  name?: string
  /** Références #N contenues dans l'argument (simple ou liste) — cliquables. */
  refs?: number[]
  /** Clé de mise en évidence ; `focusKey` du résultat désigne la valeur cliquée. */
  key?: string
}

export interface InspectLine {
  /** expressId, ou 0 pour une ligne d'en-tête (FILE_DESCRIPTION…). */
  id: number
  typeName: string
  args: InspectArg[]
  note?: string
}

export interface InspectGroup {
  title: string
  lines: InspectLine[]
}

/** Une occurrence dans une liste (instance, relation…), avec la chaîne de lignes à ouvrir. */
export interface InspectOccurrence {
  id: number
  typeName: string
  label: string | null
  /** Valeur portée par cette occurrence (propriété, attribut) ; null sinon. */
  value: string | null
  chain: number[]
  focusId?: number
  focusAttr?: string
}

export type InspectRequest =
  /** Valeur de géolocalisation / géoréférencement de l'onglet Infos projet. */
  | { kind: 'geo'; key: string }
  /** Champ de l'onglet Infos projet (projet, site, bâtiment, historique, MVD, étage, unité). */
  | { kind: 'project'; field: string; id?: number }
  /** Une ligne, avec éventuellement l'attribut à mettre en évidence. */
  | { kind: 'entity'; id: number; focusAttr?: string }
  /** Plusieurs lignes liées (élément → relation → Pset → propriété). */
  | { kind: 'chain'; ids: number[]; focusId?: number; focusAttr?: string }
  /** Attribut agrégé d'un type (Name, ObjectType…), filtré ou non sur une valeur. */
  | { kind: 'attribute'; entityType: string; attr: string; value?: string }
  /** Pset ou propriété agrégée d'un type, filtrée ou non sur une valeur. */
  | { kind: 'property'; entityType: string; pset: string; prop?: string; value?: string }
  /** Instances d'un type, ou membres d'un nœud groupé du graphe. */
  | { kind: 'instances'; entityType: string; nodeId?: string }
  /** Relations IFC d'un nœud du graphe (détail) ou entre deux types (vue d'ensemble). */
  | { kind: 'relations'; relType: GraphRelType; nodeId?: string; sourceType?: string; targetType?: string }

export interface InspectResult {
  request: InspectRequest
  family: InspectFamily
  title: string
  subtitle?: string
  groups: InspectGroup[]
  focusKey?: string
  /** Clés supplémentaires à mettre en évidence (valeur calculée à partir de plusieurs arguments). */
  focusKeys?: string[]
  occurrences?: { total: number; items: InspectOccurrence[] }
}

export type WorkerInMessage =
  | { type: 'init'; wasmPath: string }
  | { type: 'load'; buffer: ArrayBuffer }
  | { type: 'select'; entityType: string }
  | { type: 'search'; query: string }
  | { type: 'graphOpenType'; entityType: string; relTypes: GraphRelType[] }
  | { type: 'graphExpand'; nodeId: string; relTypes: GraphRelType[] }
  | { type: 'graphOverview' }
  | { type: 'inspect'; request: InspectRequest; token: number }

export type WorkerOutMessage =
  | { type: 'progress'; percent: number; phase: string }
  | { type: 'ready'; entityTypes: EntityTypeSummary[]; ifcVersion: string }
  | { type: 'projectInfo'; data: ProjectInfo }
  | { type: 'inspectResult'; result: InspectResult; token: number }
  | { type: 'aggregated'; data: AggregatedEntityData }
  | { type: 'searchResults'; query: string; results: GlobalSearchResult[] }
  | { type: 'graphData'; payload: GraphPayload }
  | { type: 'graphOverviewData'; payload: TypeGraphPayload }
  | { type: 'error'; message: string }
