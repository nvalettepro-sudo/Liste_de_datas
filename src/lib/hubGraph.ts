import { REL_META } from './graphMeta'
import type { TypeGraphNode, TypeGraphEdge, GraphRelType } from './types'

/**
 * Transforme le graphe type-à-type (IfcWall → IfcMaterial) en un graphe à
 * hubs : chaque relation IFC devient un nœud nommé, et les types s'y
 * raccordent au lieu de se relier directement entre eux. Sur une vraie
 * maquette où un type peut être relié à des dizaines d'autres, ceci évite le
 * nid d'oiseau d'arêtes directes et rend le nom de chaque relation visible en
 * permanence, sans légende ni clic.
 */
export interface HubGraphNode {
  id: string
  kind: 'type' | 'hub'
  label: string
  /** Présent uniquement pour kind='type'. */
  entityType?: string
  /** Présent uniquement pour kind='hub'. */
  relType?: GraphRelType
  count: number
}

export interface HubGraphEdge {
  id: string
  source: string
  target: string
  relType: GraphRelType
  count: number
}

export function buildHubGraph(
  nodes: TypeGraphNode[],
  edges: TypeGraphEdge[]
): { nodes: HubGraphNode[]; edges: HubGraphEdge[] } {
  const typeNodesById = new Map(nodes.map((n) => [n.id, n]))
  const usedTypeIds = new Set<string>()
  const hubRelTypes = new Set<GraphRelType>()

  // Agrège tous les types qui pointent vers le hub (source -> hub) et tous
  // ceux que le hub pointe (hub -> target), pour ne tracer qu'une seule
  // arête par type et par relation même si ce type apparaissait sur
  // plusieurs arêtes d'origine (ex. un étage contenant 7 types d'éléments).
  const inbound = new Map<string, number>()
  const outbound = new Map<string, number>()

  for (const e of edges) {
    if (e.source === e.target) continue
    hubRelTypes.add(e.relType)
    usedTypeIds.add(e.source)
    usedTypeIds.add(e.target)

    const inKey = `${e.relType}|${e.source}`
    inbound.set(inKey, (inbound.get(inKey) ?? 0) + e.count)
    const outKey = `${e.relType}|${e.target}`
    outbound.set(outKey, (outbound.get(outKey) ?? 0) + e.count)
  }

  const outNodes: HubGraphNode[] = []
  for (const id of usedTypeIds) {
    const t = typeNodesById.get(id)
    if (!t) continue
    outNodes.push({ id: t.id, kind: 'type', label: t.entityType, entityType: t.entityType, count: t.count })
  }
  for (const rel of hubRelTypes) {
    let total = 0
    const prefix = `${rel}|`
    for (const [k, v] of inbound.entries()) if (k.startsWith(prefix)) total += v
    outNodes.push({ id: `hub:${rel}`, kind: 'hub', label: REL_META[rel].label, relType: rel, count: total })
  }

  const outEdges: HubGraphEdge[] = []
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
