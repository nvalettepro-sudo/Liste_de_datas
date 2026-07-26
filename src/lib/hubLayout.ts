import type { XY } from './graphLayout'
import type { HubGraphNode, HubGraphEdge } from './hubGraph'
import type { GraphRelType } from './types'

/** Mêmes dimensions de carte que graphLayout.ts, pour un aspect visuel cohérent. */
const NODE_W = 210
const NODE_H = 92
const GAP_X = 34
const GAP_Y = 30
const LANE_GAP = 70
const HUB_H = 56
const HUB_GAP = 24

/**
 * Ratio largeur/hauteur visé pour la composition, mesuré par l'utilisateur
 * sur son propre écran (1905×1129). `fitView` adapte ensuite le zoom à la
 * fenêtre réelle, mais il ne peut pas corriger une forme interne mal
 * proportionnée — d'où l'intérêt de viser ce ratio dès le calcul des
 * positions, quelle que soit la maquette chargée.
 */
const TARGET_RATIO = 1905 / 1129

/**
 * Ordre de priorité IFC pour le rattachement d'un type à un hub — pas un
 * simple classement par volume. La structure spatiale (où se trouve
 * l'élément) et la hiérarchie d'agrégation sont les relations qui
 * organisent réellement une maquette IFC ; le type définit sa nature.
 * Matériau, Classification et Psets sont des attributs qui peuvent
 * s'appliquer à n'importe quel élément en grand nombre — les laisser
 * dominer le rattachement (par comptage brut) plaçait des éléments comme
 * IfcColumn ou IfcBeam sous "Matériau" au lieu de leur position réelle,
 * simplement parce que ces relations comptent plus d'occurrences.
 */
export const HOME_HUB_PRIORITY: readonly GraphRelType[] = [
  'IfcRelContainedInSpatialStructure',
  'IfcRelAggregates',
  'IfcRelDefinesByType',
  'IfcRelAssociatesMaterial',
  'IfcRelAssociatesClassification',
  'IfcRelDefinesByProperties',
]

/**
 * Rattache chaque type au hub de relation le plus prioritaire selon la
 * norme IFC parmi ceux qu'il touche réellement (pas au hub le plus
 * volumineux). Sert à la fois au calcul du layout (regroupement en
 * couloirs) et au déplacement de groupe dans l'interface — déplacer un hub
 * doit entraîner avec lui les mêmes types que ceux qu'il a "sous lui" dans
 * le layout.
 */
export function computeHomeHubs(
  nodes: HubGraphNode[],
  edges: HubGraphEdge[],
  priority: readonly GraphRelType[] = HOME_HUB_PRIORITY
): Map<string, string> {
  const hubRelById = new Map<string, GraphRelType>()
  for (const n of nodes) {
    if (n.kind === 'hub' && n.relType) hubRelById.set(n.id, n.relType)
  }

  const touchedHubs = new Map<string, Set<string>>()
  for (const e of edges) {
    const sourceIsHub = hubRelById.has(e.source)
    const hubId = sourceIsHub ? e.source : e.target
    const typeId = sourceIsHub ? e.target : e.source
    if (!hubRelById.has(hubId) || typeId === hubId) continue
    if (!touchedHubs.has(typeId)) touchedHubs.set(typeId, new Set())
    touchedHubs.get(typeId)!.add(hubId)
  }

  const home = new Map<string, string>()
  for (const [typeId, hubIds] of touchedHubs.entries()) {
    let chosen: string | undefined
    for (const rel of priority) {
      chosen = Array.from(hubIds).find((hubId) => hubRelById.get(hubId) === rel)
      if (chosen) break
    }
    home.set(typeId, chosen ?? Array.from(hubIds)[0])
  }
  return home
}

/**
 * Dispose le graphe à hubs en couloirs : un couloir par relation IFC active,
 * le hub en en-tête et les types qui lui sont rattachés repliés en grille
 * dessous. Remplace le layout dagre générique, qui classait les types par
 * distance de calcul dans le graphe — un critère sans rapport avec la norme
 * IFC — plutôt que par la relation qui les relie réellement.
 *
 * Un type relié à plusieurs hubs est rattaché à celui dont le poids (nombre
 * d'occurrences de la relation) est le plus fort ; les arêtes vers ses
 * autres hubs restent tracées, elles traversent simplement les couloirs.
 */
export function layoutHubGraph(
  nodes: HubGraphNode[],
  edges: HubGraphEdge[],
  relOrder: readonly GraphRelType[]
): Record<string, XY> {
  const hubs = nodes.filter((n): n is HubGraphNode & { relType: GraphRelType } => n.kind === 'hub' && !!n.relType)

  const orderedHubs = relOrder
    .map((rel) => hubs.find((h) => h.relType === rel))
    .filter((h): h is HubGraphNode & { relType: GraphRelType } => !!h)

  const home = computeHomeHubs(nodes, edges)

  const laneMembers = new Map<string, string[]>()
  for (const h of orderedHubs) laneMembers.set(h.id, [])
  for (const [typeId, hubId] of home.entries()) {
    if (!laneMembers.has(hubId)) laneMembers.set(hubId, [])
    laneMembers.get(hubId)!.push(typeId)
  }

  // Tous les hubs actifs reçoivent une position, même sans membre "domicilié"
  // chez eux : un hub relié à des types qui préfèrent tous un autre hub plus
  // fort n'en reste pas moins un nœud affiché, avec ses propres arêtes — le
  // laisser sans position le faisait flotter à l'origine du canevas.
  const laneList = orderedHubs
  if (laneList.length === 0) return {}

  // Cherche le nombre de lignes par couloir qui rapproche le ratio global
  // du format visé, en essayant chaque valeur plausible.
  let bestRows = 1
  let bestDiff = Infinity
  const H = laneList.length
  for (let rows = 1; rows <= 30; rows++) {
    let totalCols = 0
    for (const h of laneList) {
      const n = laneMembers.get(h.id)!.length
      totalCols += Math.max(1, Math.ceil(n / rows))
    }
    const width = totalCols * (NODE_W + GAP_X) + (H - 1) * LANE_GAP
    const height = rows * (NODE_H + GAP_Y) + HUB_H + HUB_GAP
    const diff = Math.abs(width / height - TARGET_RATIO)
    if (diff < bestDiff) {
      bestDiff = diff
      bestRows = rows
    }
  }

  const rows = bestRows
  const positions: Record<string, XY> = {}
  let x = 0

  for (const h of laneList) {
    const members = laneMembers.get(h.id)!
    const cols = Math.max(1, Math.ceil(members.length / rows))
    const laneWidth = cols * (NODE_W + GAP_X) - GAP_X

    positions[h.id] = { x: x + laneWidth / 2 - NODE_W / 2, y: 0 }

    members.forEach((typeId, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      positions[typeId] = {
        x: x + col * (NODE_W + GAP_X),
        y: HUB_H + HUB_GAP + row * (NODE_H + GAP_Y),
      }
    })

    x += laneWidth + LANE_GAP
  }

  return positions
}
