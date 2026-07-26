import type { GraphRelType } from './types'

/**
 * Cœur commun à buildHubGraph (vue d'ensemble, types) et buildDetailHubGraph
 * (vue détail, instances) : les deux transforment un graphe brut en un
 * graphe à hubs de relation nommés en suivant exactement le même algorithme
 * d'agrégation — seule la façon de projeter un nœud "feuille" (type vs
 * instance) diffère, d'où les callbacks `toLeafNode`/`toHubNode`.
 */
export interface HubCoreEdgeInput {
  source: string
  target: string
  relType: GraphRelType
  count: number
}

export interface HubEdge {
  id: string
  source: string
  target: string
  relType: GraphRelType
  count: number
}

export function buildHubGraphCore<TLeaf extends { id: string }, TOut>(
  nodes: TLeaf[],
  edges: HubCoreEdgeInput[],
  toLeafNode: (n: TLeaf) => TOut,
  toHubNode: (relType: GraphRelType, count: number) => TOut
): { nodes: TOut[]; edges: HubEdge[] } {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const usedIds = new Set<string>()
  const hubRelTypes = new Set<GraphRelType>()

  // Agrège tous les nœuds qui pointent vers le hub (source -> hub) et tous
  // ceux que le hub pointe (hub -> target), pour ne tracer qu'une seule
  // arête par nœud et par relation même si ce nœud apparaissait sur
  // plusieurs arêtes d'origine (ex. un étage contenant 7 éléments).
  const inbound = new Map<string, number>()
  const outbound = new Map<string, number>()
  const hubTotals = new Map<GraphRelType, number>()

  for (const e of edges) {
    if (e.source === e.target) continue
    hubRelTypes.add(e.relType)
    usedIds.add(e.source)
    usedIds.add(e.target)

    const inKey = `${e.relType}|${e.source}`
    inbound.set(inKey, (inbound.get(inKey) ?? 0) + e.count)
    const outKey = `${e.relType}|${e.target}`
    outbound.set(outKey, (outbound.get(outKey) ?? 0) + e.count)
    hubTotals.set(e.relType, (hubTotals.get(e.relType) ?? 0) + e.count)
  }

  const outNodes: TOut[] = []
  for (const id of usedIds) {
    const n = nodeById.get(id)
    if (n) outNodes.push(toLeafNode(n))
  }
  for (const rel of hubRelTypes) {
    outNodes.push(toHubNode(rel, hubTotals.get(rel) ?? 0))
  }

  const outEdges: HubEdge[] = []
  for (const [key, count] of inbound.entries()) {
    const sep = key.indexOf('|')
    const rel = key.slice(0, sep) as GraphRelType
    const source = key.slice(sep + 1)
    outEdges.push({ id: `in:${key}`, source, target: `hub:${rel}`, relType: rel, count })
  }
  for (const [key, count] of outbound.entries()) {
    const sep = key.indexOf('|')
    const rel = key.slice(0, sep) as GraphRelType
    const target = key.slice(sep + 1)
    outEdges.push({ id: `out:${key}`, source: `hub:${rel}`, target, relType: rel, count })
  }

  return { nodes: outNodes, edges: outEdges }
}
