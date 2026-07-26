import { REL_META } from './graphMeta'
import type { GraphNode, GraphEdge, GraphRelType } from './types'
import { buildHubGraphCore, type HubEdge } from './hubGraphCore'

/**
 * Équivalent de buildHubGraph (vue d'ensemble) pour la vue détail : les
 * nœuds y sont des instances ou des groupes d'occurrences, pas de simples
 * types, donc les champs d'origine (expressId, globalId, expandable...)
 * doivent être conservés pour que le double-clic et l'affichage restent
 * fonctionnels — d'où un type de sortie dédié, tout en partageant le même
 * algorithme d'agrégation via buildHubGraphCore.
 */
export type DetailNode =
  | (GraphNode & { isHub?: false })
  | { id: string; isHub: true; kind: 'hub'; relType: GraphRelType; label: string; count: number }

export type DetailEdge = HubEdge

export function buildDetailHubGraph(
  nodes: GraphNode[],
  edges: GraphEdge[]
): { nodes: DetailNode[]; edges: DetailEdge[] } {
  return buildHubGraphCore<GraphNode, DetailNode>(
    nodes,
    edges,
    (n) => n,
    (rel, count) => ({ id: `hub:${rel}`, isHub: true, kind: 'hub', relType: rel, label: REL_META[rel].label, count })
  )
}
