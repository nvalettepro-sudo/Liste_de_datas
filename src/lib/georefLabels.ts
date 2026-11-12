import type { Certainty, GeoStatus } from './types'

/** Statuts (spéc. §5) : libellé du badge et explication affichée. */
export const STATUS_INFO: Record<GeoStatus, { label: string; text: string; tone: 'ok' | 'mid' | 'low' | 'none' }> = {
  GEOREF_COMPLET: {
    label: 'Géoréférencé',
    text: 'La maquette est posée sur une carte connue, avec une position et une rotation.',
    tone: 'ok',
  },
  GEOREF_IDENTITE: {
    label: 'Géoréférencé — conversion identité',
    text: 'Une carte est déclarée et la conversion vaut zéro : les coordonnées du projet se lisent directement sur cette carte.',
    tone: 'ok',
  },
  GEOREF_SANS_CRS: {
    label: 'Géoréférencé, carte inconnue',
    text: 'Les coordonnées existent, mais on ne sait pas sur quelle carte les lire.',
    tone: 'mid',
  },
  POSITION_LOCALE: {
    label: 'Coordonnées sans carte',
    text: 'Le terrain a des coordonnées, mais aucune carte n’est déclarée. C’est le cas normal en IFC 2x3.',
    tone: 'mid',
  },
  AUCUN: {
    label: 'Non géoréférencé',
    text: 'Le fichier ne donne ni conversion vers une carte, ni coordonnées de terrain.',
    tone: 'none',
  },
}

/** Badge de certitude (spéc. §0) — rien pour VÉRIFIÉ. */
export function certaintyBadge(c: Certainty, schema: string): { label: string; title: string } | null {
  switch (c) {
    case 'VERIFIE':
      return null
    case 'VERIFIE_2X3':
      return schema === 'IFC2X3'
        ? null
        : { label: 'vérifié en IFC2x3 seulement', title: 'Comportement constaté dans Solibri sur des fichiers IFC2x3, pas encore pour ce schéma.' }
    case 'STANDARD':
      return { label: 'non comparé à Solibri', title: 'Règle définie par la norme IFC, pas encore comparée à l’affichage de Solibri.' }
    case 'HYPOTHESE':
      return { label: 'hypothèse', title: 'Déduction ou convention de logiciel, non confirmée : à ne pas considérer comme certaine.' }
  }
}

/** Catalogue des libellés (spéc. §9) : libellé court, nom IFC, explication simple et détaillée. */
export const GEO_LABELS: Record<string, { label: string; ifc: string; simple: string; detail?: string }> = {
  'map.eastings': {
    label: 'Est (E)', ifc: 'IfcMapConversion.Eastings',
    simple: 'Distance vers l’est, sur la carte, de l’origine du projet.',
  },
  'map.northings': {
    label: 'Nord (N)', ifc: 'IfcMapConversion.Northings',
    simple: 'Distance vers le nord, sur la carte, de l’origine du projet.',
  },
  'map.height': {
    label: 'Altitude', ifc: 'IfcMapConversion.OrthogonalHeight',
    simple: 'Altitude de l’origine du projet, par rapport au datum vertical.',
  },
  'map.rotation': {
    label: 'Rotation', ifc: 'XAxisAbscissa, XAxisOrdinate',
    simple: 'De combien la maquette est tournée par rapport à la carte.',
    detail: 'θ = atan2(XAxisOrdinate, XAxisAbscissa), anti-horaire autour de Z, de l’axe est de la carte vers l’axe X du projet, ramené entre 0 et 360°.',
  },
  'map.scale': {
    label: 'Échelle', ifc: 'IfcMapConversion.Scale',
    simple: 'Agrandissement. 1 = aucun.',
    detail: 'Sert quand l’unité de la carte diffère de celle du projet. Absent = 1.',
  },
  'crs.name': {
    label: 'Carte', ifc: 'IfcProjectedCRS.Name',
    simple: 'Le nom ou le code de la carte utilisée.',
    detail: 'Un CRS projeté transforme la surface de la Terre en un plan gradué en mètres. Les chiffres Eastings / Northings n’ont de sens que sur cette carte. En cas de doute, le code EPSG fait foi.',
  },
  'crs.datum': {
    label: 'Datum', ifc: 'GeodeticDatum, VerticalDatum',
    simple: 'La forme de la Terre et le zéro des altitudes de cette carte.',
  },
  'site.xyz': {
    label: 'Position du terrain', ifc: 'IfcSite → IfcCartesianPoint.Coordinates',
    simple: 'Où se trouve le terrain dans le repère du projet.',
    detail: 'Chemin : IfcSite.ObjectPlacement → IfcLocalPlacement → IfcAxis2Placement3D.Location → IfcCartesianPoint. Ces chiffres ne sont rattachés à aucune carte : c’est le logiciel d’export qui y met, ou non, des coordonnées de chantier. C’est la valeur que Solibri affiche en IFC2x3, signe compris.',
  },
  'site.rotation': {
    label: 'Rotation du terrain', ifc: 'IfcAxis2Placement3D.RefDirection',
    simple: 'De combien le terrain est tourné dans le repère du projet.',
  },
  'site.latlong': {
    label: 'Position GPS indicative', ifc: 'IfcSite.RefLatitude, RefLongitude',
    simple: 'Où se trouve le projet sur le globe, approximativement.',
    detail: 'WGS84, en degrés, minutes, secondes et millionièmes. Ces valeurs situent le point 0, 0, 0 du site de façon approximative ; la position précise doit venir des entités de géoréférencement. Le texte IFC2x3 de IfcSite dit que les longitudes à l’ouest sont positives, mais les fichiers testés écrivent l’est en positif : une valeur positive est affichée comme Est.',
  },
  'site.elevation': {
    label: 'Altitude indicative', ifc: 'IfcSite.RefElevation',
    simple: 'Altitude de référence du terrain, indicative.',
    detail: 'Ce n’est pas l’altitude du géoréférencement (Solibri ne l’utilise pas).',
  },
  'ctx.trueNorth': {
    label: 'Nord', ifc: 'IfcGeometricRepresentationContext.TrueNorth',
    simple: 'La flèche du nord sur le plan du projet.',
    detail: 'α = atan2(−x, y), compté dans le sens anti-horaire depuis l’axe +Y. Absent : le nord est l’axe +Y. Le nord oriente le projet mais ne le place pas.',
  },
  'site.mapPosition': {
    label: 'Position carte du terrain', ifc: 'calculée (§7.2)',
    simple: 'Où tombe l’origine du terrain sur la carte.',
    detail: 'E = s(x cos θ − y sin θ) + Eastings ; N = s(x sin θ + y cos θ) + Northings ; H = s·z + OrthogonalHeight. Valeur calculée par l’application, pas écrite dans le fichier.',
  },
}
