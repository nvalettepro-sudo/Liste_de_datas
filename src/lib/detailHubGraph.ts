import { REL_META } from './graphMeta'
import type { GraphNode, GraphEdge, GraphRelType } from './types'

/**
 * Équivalent de buildHubGraph (vue d'ensemble) pour la vue détail : les
 * nœuds y sont des instances ou des groupes d'occurrences, pas de simples
 * types, donc les champs d'origine (expressId, globalId, expandable...)
 * doivent être conservés pour que le double-clic et l'affichage restent
 * fonctionnels — d'où une structure dédiée plutôt qu'un partage direct avec
 * HubGraphNode.
 */
export type DetailNode =
  | (GraphNode & { isHub?: false })
  | { id: string; isHub: true; kind: 'hub'; relType: GraphRelType; label: string; count: number }

export interface DetailEdge {
  id: string
  source: string
  target: string
  relType: GraphRelType
  count: number
}

export function buildDetailHubGraph(
  nodes: GraphNode[],
  edges: GraphEdge[]
): { nodes: DetailNode[]; edges: DetailEdge[] } {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const usedIds = new Set<string>()
  const hubRelTypes = new Set<GraphRelType>()

  const inbound = new Map<string, number>()
  const outbound = new Map<string, number>()

  for (const e of edges) {
    if (e.source === e.target) continue
    hubRelTypes.add(e.relType)
    usedIds.add(e.source)
    usedIds.add(e.target)

    const inKey = `${e.relType}|${e.source}`
    inbound.set(inKey, (inbound.get(inKey) ?? 0) + e.count)
    const outKey = `${e.relType}|${e.target}`
    outbound.set(outKey, (outbound.get(outKey) ?? 0) + e.count)
  }

  const outNodes: DetailNode[] = []
  for (const id of usedIds) {
    const n = nodeById.get(id)
    if (n) outNodes.push(n)
  }
  for (const rel of hubRelTypes) {
    let total = 0
    const prefix = `${rel}|`
    for (const [k, v] of inbound.entries()) if (k.startsWith(prefix)) total += v
    outNodes.push({ id: `hub:${rel}`, isHub: true, kind: 'hub', relType: rel, label: REL_META[rel].label, count: total })
  }

  const outEdges: DetailEdge[] = []
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
