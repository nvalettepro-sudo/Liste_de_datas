import {
  useInternalNode,
  getBezierPath,
  BaseEdge,
  Position,
  type EdgeProps,
  type InternalNode,
  type Node,
} from '@xyflow/react'

/**
 * Point d'intersection entre le segment reliant les centres de deux nœuds et
 * le contour du premier (approximé par une ellipse inscrite dans sa boîte —
 * suffisant pour des cartes rectangulaires, et ça donne un point continu
 * quel que soit l'angle plutôt qu'un simple choix haut/bas/gauche/droite).
 */
function getNodeIntersection(intersectionNode: InternalNode<Node>, targetNode: InternalNode<Node>) {
  const w = (intersectionNode.measured.width ?? 0) / 2
  const h = (intersectionNode.measured.height ?? 0) / 2
  const x2 = intersectionNode.internals.positionAbsolute.x + w
  const y2 = intersectionNode.internals.positionAbsolute.y + h
  const x1 = targetNode.internals.positionAbsolute.x + (targetNode.measured.width ?? 0) / 2
  const y1 = targetNode.internals.positionAbsolute.y + (targetNode.measured.height ?? 0) / 2

  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h)
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h)
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1)
  const xx3 = a * xx1
  const yy3 = a * yy1

  return {
    x: w * (xx3 + yy3) + x2,
    y: h * (-xx3 + yy3) + y2,
  }
}

/** Déduit de quel côté du nœud sort le point d'intersection, pour orienter la courbe. */
function getEdgePosition(node: InternalNode<Node>, intersectionPoint: { x: number; y: number }) {
  const nx = Math.round(node.internals.positionAbsolute.x)
  const ny = Math.round(node.internals.positionAbsolute.y)
  const px = Math.round(intersectionPoint.x)
  const py = Math.round(intersectionPoint.y)
  const w = node.measured.width ?? 0
  const h = node.measured.height ?? 0

  if (px <= nx + 1) return Position.Left
  if (px >= nx + w - 1) return Position.Right
  if (py <= ny + 1) return Position.Top
  if (py >= ny + h - 1) return Position.Bottom
  return Position.Top
}

/**
 * Arête "flottante" : le point de connexion sur chaque étiquette se recalcule
 * à chaque rendu d'après la position relative réelle des deux étiquettes
 * (via useInternalNode, qui suit le store en direct pendant un glisser),
 * plutôt que de toujours partir du bas pour arriver en haut. Objectif :
 * limiter les tracés qui passent derrière une étiquette pour rejoindre un
 * point de connexion fixe et mal placé.
 */
export function FloatingEdge({
  id,
  source,
  target,
  markerEnd,
  style,
  label,
  labelStyle,
  labelBgStyle,
}: EdgeProps) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)

  if (!sourceNode || !targetNode || !sourceNode.measured.width || !targetNode.measured.width) {
    return null
  }

  const sourceIntersection = getNodeIntersection(sourceNode, targetNode)
  const targetIntersection = getNodeIntersection(targetNode, sourceNode)
  const sourcePos = getEdgePosition(sourceNode, sourceIntersection)
  const targetPos = getEdgePosition(targetNode, targetIntersection)

  const [path] = getBezierPath({
    sourceX: sourceIntersection.x,
    sourceY: sourceIntersection.y,
    sourcePosition: sourcePos,
    targetX: targetIntersection.x,
    targetY: targetIntersection.y,
    targetPosition: targetPos,
  })

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={style}
      label={label}
      labelStyle={labelStyle}
      labelBgStyle={labelBgStyle}
    />
  )
}
