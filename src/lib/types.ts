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

/* ---------- Géoréférencement (spécification « Géoréférencement IFC — lecture et affichage ») ---------- */

/**
 * Niveau de certitude d'une règle (spéc. §0) :
 * VERIFIE = standard officiel ou constaté dans Solibri ; VERIFIE_2X3 = constaté
 * dans Solibri en IFC2x3 seulement ; STANDARD = défini par la norme, non
 * comparé à Solibri ; HYPOTHESE = déduction ou convention non confirmée.
 */
export type Certainty = 'VERIFIE' | 'VERIFIE_2X3' | 'STANDARD' | 'HYPOTHESE'

/**
 * Statut global (spéc. §5). GEOREF_IDENTITE est un ajout à la spécification :
 * IfcMapConversion nulle mais carte (CRS) identifiée — les coordonnées du
 * repère du projet se lisent directement sur la carte.
 */
export type GeoStatus =
  | 'GEOREF_COMPLET'
  | 'GEOREF_IDENTITE'
  | 'GEOREF_SANS_CRS'
  | 'POSITION_LOCALE'
  | 'GPS_SEUL'
  | 'AUCUN'

export type GeoPrimarySource = 'MAP_CONVERSION' | 'SITE_PLACEMENT' | 'SITE_LATLONG' | null

export interface XYZ {
  x: number
  y: number
  z: number
}

/** Fiche 4.1 / 4.3 / 4.4 — valeurs brutes, dans l'unité de longueur du fichier. */
export interface GeoMapConversion {
  stepId: number
  type: 'IfcMapConversion' | 'IfcMapConversionScaled' | 'IfcRigidOperation'
  sourceContextStepId: number | null
  sourceContextDim: number | null
  eastings: number | null
  northings: number | null
  orthogonalHeight: number | null
  xAxisAbscissa: number | null
  xAxisOrdinate: number | null
  scale: number | null
  scaleEffective: number
  factors: { x: number | null; y: number | null; z: number | null } | null
  /** θ (§7.1), en degrés entre 0 et 360 ; null si direction invalide. */
  rotationDeg: number | null
  rotationMissing: boolean
  rotationValid: boolean
  isZero: boolean
  certainty: Certainty
}

/** Fiche 4.2. */
export interface GeoCrs {
  stepId: number
  type: string
  name: string | null
  epsgCode: number | null
  description: string | null
  geodeticDatum: string | null
  verticalDatum: string | null
  mapProjection: string | null
  mapZone: string | null
  mapUnit: string | null
  wkt: string | null
}

export interface GeoAngle {
  raw: number[]
  decimal: number
  /** « 48° 51' 12,2485" N » */
  dms: string
}

/** Fiches 4.5 et 4.6. */
export interface GeoSite {
  stepId: number
  name: string | null
  isPrimary: boolean
  placement: {
    localPlacementStepId: number
    relativeToStepId: number | null
    pointStepId: number | null
    pointType: string | null
    x: number
    y: number
    z: number
    refDirection: XYZ | null
    rotationDeg: number
    isZero: boolean
    composed: boolean
    certainty: Certainty
  } | null
  refLatitude: GeoAngle | null
  refLongitude: GeoAngle | null
  refElevation: number | null
  /** §7.2 — origine du terrain sur la carte ; null sans conversion exploitable. */
  mapPosition: { e: number; n: number; h: number } | null
}

export interface GeoCheck {
  /** Code stable, ex. CASE_08_MULTIPLE_MAP_CONVERSIONS. */
  code: string
  severity: 'ok' | 'info' | 'warn'
  text: string
  certainty: Certainty
  /** Clé de l'inspecteur pour voir les lignes concernées. */
  key?: string
}

/** Objet unique produit par l'analyse (spéc. §9) ; l'interface ne lit que lui. */
export interface GeoAnalysis {
  schema: string
  fileSchemaRaw: string | null
  authoringTool: string | null
  /** Origine des coordonnées déclarée par Revit (FILE_DESCRIPTION). */
  coordinateBase: string | null
  lengthUnit: { name: string; prefix: string | null; toMetre: number; stepId: number | null }
  status: GeoStatus
  statusCertainty: Certainty
  primarySource: GeoPrimarySource
  mapConversion: GeoMapConversion | null
  otherMapConversions: GeoMapConversion[]
  crs: GeoCrs | null
  sites: GeoSite[]
  context: {
    stepId: number
    dim: number | null
    wcs: XYZ & { isIdentity: boolean }
    trueNorth: { x: number; y: number; stepId: number | null; angleDeg: number; isDefault: boolean }
  } | null
  checks: GeoCheck[]
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
  projectName: string | null
  projectLongName: string | null
  projectPhase: string | null
  siteName: string | null
  siteAddress: string | null
  buildingName: string | null
  storeys: StoreyInfo[]
  /** Analyse complète du géoréférencement (spéc. §9). */
  geo: GeoAnalysis
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
