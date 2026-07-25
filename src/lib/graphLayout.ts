import dagre from 'dagre'

/** Taille approximative d'une carte de nœud — cf. GraphNodeCard.tsx. */
const NODE_WIDTH = 210
const NODE_HEIGHT = 92

export interface XY { x: number; y: number }

interface LayoutNode { id: string }
interface LayoutEdge { source: string; target: string }

export interface LayoutOptions {
  nodesep?: number
  ranksep?: number
  rankdir?: 'LR' | 'TB'
  /** Au-delà, un niveau est replié en grille plutôt qu'empilé en colonne unique. */
  wrapThreshold?: number
}

/**
 * Calcule un layout hiérarchique complet avec dagre, puis replie en grille
 * les niveaux qui comptent trop de nœuds.
 *
 * Sans ce repli, un graphe où la majorité des types pointent vers un même
 * nœud (ex. tous les éléments reliés à leur étage) finit empilé en une seule
 * colonne très haute et étroite : dagre place chaque niveau du graphe le long
 * d'un axe, et tous les autres nœuds de ce niveau le long de l'axe
 * perpendiculaire, sans jamais revenir à la ligne. `fitView` doit alors
 * réduire le zoom pour caler cette colonne dans la hauteur de la fenêtre,
 * laissant tout l'espace horizontal inutilisé — quelle que soit la maquette
 * chargée, dès qu'un type est relié à beaucoup d'autres.
 *
 * On garde de dagre uniquement le niveau (rang) et l'ordre anti-croisements
 * de chaque nœud ; la position finale de chaque niveau est recalculée pour
 * remplir un rectangle plutôt qu'une ligne.
 */
export function layoutGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions = {}
): Record<string, XY> {
  const { nodesep = 55, ranksep = 130, rankdir = 'LR', wrapThreshold = 8 } = options

  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir, nodesep, ranksep, marginx: 40, marginy: 40 })
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

  const isLR = rankdir === 'LR'

  // Regroupe par rang (axe du flux) en conservant l'ordre anti-croisements
  // calculé par dagre au sein de chaque rang.
  const groups = new Map<number, { id: string; order: number }[]>()
  for (const n of nodes) {
    const p = g.node(n.id)
    if (!p) continue
    const rankVal = Math.round(isLR ? p.x : p.y)
    const order = isLR ? p.y : p.x
    if (!groups.has(rankVal)) groups.set(rankVal, [])
    groups.get(rankVal)!.push({ id: n.id, order })
  }

  const ranks = Array.from(groups.keys()).sort((a, b) => a - b)
  const rankStep = (isLR ? NODE_WIDTH : NODE_HEIGHT) + ranksep
  const itemStep = (isLR ? NODE_HEIGHT : NODE_WIDTH) + nodesep
  const wrapStep = (isLR ? NODE_WIDTH : NODE_HEIGHT) + nodesep * 0.6

  const positions: Record<string, XY> = {}
  let rankPos = 0

  for (const rankVal of ranks) {
    const members = groups.get(rankVal)!.sort((a, b) => a.order - b.order)
    const count = members.length

    if (count <= wrapThreshold) {
      members.forEach((m, i) => {
        positions[m.id] = isLR ? { x: rankPos, y: i * itemStep } : { x: i * itemStep, y: rankPos }
      })
      rankPos += rankStep
    } else {
      // Grille plutôt que colonne : les cartes étant déjà plus larges que
      // hautes, une grille à peu près carrée en nombre de nœuds donne un
      // résultat en pixels proche du format paysage.
      const cols = Math.max(1, Math.round(Math.sqrt(count)))
      members.forEach((m, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        positions[m.id] = isLR
          ? { x: rankPos + col * wrapStep, y: row * itemStep }
          : { x: col * itemStep, y: rankPos + row * wrapStep }
      })
      rankPos += rankStep + (cols - 1) * wrapStep
    }
  }

  return positions
}
