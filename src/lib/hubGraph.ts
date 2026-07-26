import { REL_META } from './graphMeta'
import type { TypeGraphNode, TypeGraphEdge, GraphRelType } from './types'
import { buildHubGraphCore, type HubEdge } from './hubGraphCore'

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

export type HubGraphEdge = HubEdge

export function buildHubGraph(
  nodes: TypeGraphNode[],
  edges: TypeGraphEdge[]
): { nodes: HubGraphNode[]; edges: HubGraphEdge[] } {
  return buildHubGraphCore<TypeGraphNode, HubGraphNode>(
    nodes,
    edges,
    (t) => ({ id: t.id, kind: 'type', label: t.entityType, entityType: t.entityType, count: t.count }),
    (rel, count) => ({ id: `hub:${rel}`, kind: 'hub', label: REL_META[rel].label, relType: rel, count })
  )
}
