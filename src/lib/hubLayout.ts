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
  const hubIds = new Set(hubs.map((h) => h.id))

  const orderedHubs = relOrder
    .map((rel) => hubs.find((h) => h.relType === rel))
    .filter((h): h is HubGraphNode & { relType: GraphRelType } => !!h)

  // Poids type -> hub : quel hub "pèse" le plus pour ce type.
  const weight = new Map<string, Map<string, number>>()
  for (const e of edges) {
    const typeId = hubIds.has(e.source) ? e.target : e.source
    const hubId = hubIds.has(e.source) ? e.source : e.target
    if (!hubIds.has(hubId) || typeId === hubId) continue
    if (!weight.has(typeId)) weight.set(typeId, new Map())
    const m = weight.get(typeId)!
    m.set(hubId, (m.get(hubId) ?? 0) + e.count)
  }

  const home = new Map<string, string>()
  for (const [typeId, m] of weight.entries()) {
    let bestHub = ''
    let bestW = -1
    for (const [hubId, w] of m.entries()) {
      if (w > bestW) {
        bestW = w
        bestHub = hubId
      }
    }
    if (bestHub) home.set(typeId, bestHub)
  }

  const laneMembers = new Map<string, string[]>()
  for (const h of orderedHubs) laneMembers.set(h.id, [])
  for (const [typeId, hubId] of home.entries()) {
    if (!laneMembers.has(hubId)) laneMembers.set(hubId, [])
    laneMembers.get(hubId)!.push(typeId)
  }

  const laneList = orderedHubs.filter((h) => (laneMembers.get(h.id)?.length ?? 0) > 0)
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
