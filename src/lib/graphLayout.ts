import dagre from 'dagre'
import type { GraphNode, GraphEdge } from './types'

/** Taille approximative d'une carte de nœud — cf. GraphNodeCard.tsx. */
const NODE_WIDTH = 210
const NODE_HEIGHT = 92

export interface XY { x: number; y: number }

/**
 * Recalcule un layout hiérarchique complet du graphe avec dagre. Contrairement
 * à un placement en anneau par zone d'expansion, ceci réorganise l'ensemble à
 * chaque appel : c'est ce qui évite les enchevêtrements quand plusieurs zones
 * du graphe ont été étendues indépendamment. Le rootId est ignoré par dagre
 * lui-même (le layout n'a pas besoin d'une racine explicite) mais on le
 * conserve en signature pour un futur ancrage si nécessaire.
 */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): Record<string, XY> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 55, ranksep: 130, marginx: 40, marginy: 40 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target)
    }
  }

  dagre.layout(g)

  const positions: Record<string, XY> = {}
  for (const n of nodes) {
    const p = g.node(n.id)
    if (p) positions[n.id] = { x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2 }
  }
  return positions
}
