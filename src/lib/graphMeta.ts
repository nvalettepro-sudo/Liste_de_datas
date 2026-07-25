import type { GraphRelType } from './types'

/** Libellé court et couleur d'arête pour chaque relation exposée dans le graphe. */
export const REL_META: Record<GraphRelType, { label: string; color: string; hint: string }> = {
  IfcRelAssociatesMaterial: {
    label: 'Matériau',
    color: '#a78bfa',
    hint: 'Élément → Matériau',
  },
  IfcRelAssociatesClassification: {
    label: 'Classification',
    color: '#f472b6',
    hint: 'Élément → Classification',
  },
  IfcRelDefinesByType: {
    label: 'Type',
    color: '#38bdf8',
    hint: 'Occurrence → Type',
  },
  IfcRelContainedInSpatialStructure: {
    label: 'Contenu dans',
    color: '#fbbf24',
    hint: 'Étage/Espace → Élément',
  },
  IfcRelAggregates: {
    label: 'Agrégation',
    color: '#34d399',
    hint: 'Hiérarchie spatiale',
  },
  IfcRelDefinesByProperties: {
    label: 'PropertySets',
    color: '#94a3b8',
    hint: 'Élément → Pset (volumineux)',
  },
}
