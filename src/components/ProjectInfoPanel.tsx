import { useState, type ReactNode } from 'react'
import { useStore } from '../store/useStore'
import { IfcLink } from './IfcLink'
import type { InspectRequest } from '../lib/types'

/**
 * Ligne libellé : valeur. Avec `req`, la valeur devient cliquable et ouvre
 * à droite la ligne du fichier IFC d'où elle provient.
 */
function Row({ label, value, req }: { label: string; value: ReactNode; req?: InspectRequest }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="text-gray-500 flex-shrink-0">{label}</span>
      {req ? (
        <IfcLink request={req} className="text-gray-200 text-right break-words min-w-0">{value}</IfcLink>
      ) : (
        <span className="text-gray-200 text-right break-words min-w-0">{value}</span>
      )}
    </div>
  )
}

function Section({
  title,
  source,
  children,
  defaultOpen = true,
  accent = false,
}: {
  title: string
  /** Entités IFC d'où viennent les valeurs, affichées sous le titre. */
  source?: string
  children: ReactNode
  defaultOpen?: boolean
  /** Encart mis en avant (géoréférencement). */
  accent?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={accent ? 'border border-amber-700/70 bg-amber-950/20' : 'border border-gray-800 bg-gray-900/40'}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-start justify-between gap-2 px-2.5 py-1.5 hover:bg-gray-800/50 transition-colors text-left"
      >
        <span className="min-w-0">
          <span className={`block text-xs font-semibold uppercase tracking-wider ${accent ? 'text-amber-300' : 'text-gray-400'}`}>{title}</span>
          {source && <span className="block text-[10px] font-mono text-gray-600 normal-case tracking-normal break-words">{source}</span>}
        </span>
        <span className="text-gray-700 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-2.5 pb-2 pt-0.5 text-xs space-y-0.5">{children}</div>}
    </div>
  )
}

const fmt = (v: number | null | undefined, digits = 3) =>
  v === null || v === undefined ? null : (Object.is(v, -0) || Math.abs(v) < 5 * 10 ** -(digits + 1) ? 0 : v).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })

function Warn({ children }: { children: ReactNode }) {
  return <p className="text-amber-400/90 text-[11px] leading-snug py-0.5">⚠ {children}</p>
}

interface Check {
  level: 'ok' | 'warn' | 'info'
  text: string
  req?: InspectRequest
}

/** Seuil au-delà duquel deux altitudes censées coïncider sont signalées (m). */
const ELEVATION_TOLERANCE = 0.01

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-gray-600 italic py-0.5">{children}</p>
}

export function ProjectInfoPanel() {
  const projectInfo = useStore((s) => s.projectInfo)

  if (!projectInfo) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-gray-700 text-xs italic text-center">Aucune information de projet disponible</p>
      </div>
    )
  }

  const { georeference, geolocation, ownerHistory } = projectInfo
  const mc = georeference?.mapConversion ?? null
  const result = mc ? georeference?.projectedPosition ?? null : georeference?.sitePosition ?? null
  const mcIsZero = !!mc && Math.abs(mc.eastings ?? 0) < 1 && Math.abs(mc.northings ?? 0) < 1 && Math.abs(mc.orthogonalHeight ?? 0) < 0.001
  const site = georeference?.sitePosition ?? null
  const siteFar = !!site && (Math.abs(site.x) > 1000 || Math.abs(site.y) > 1000)

  const checks: Check[] = []
  if (projectInfo.coordinateBase) {
    checks.push({ level: 'info', text: `Origine de l'export Revit : ${projectInfo.coordinateBase}`, req: { kind: 'project', field: 'coordinateBase' } })
  }
  if (!georeference?.crs) {
    checks.push({ level: 'warn', text: 'Aucun IfcProjectedCRS : système de coordonnées non déclaré.' })
  }
  if (!mc) {
    checks.push({ level: 'warn', text: projectInfo.schema === 'IFC2X3' ? 'IFC2x3 : pas d’IfcMapConversion possible, seule la géolocalisation (lat/long) est disponible.' : 'Aucun IfcMapConversion : modèle non géoréférencé au sens IFC4.' })
  } else if (mcIsZero && siteFar) {
    checks.push({ level: 'warn', text: 'Géoréférencement porté par le placement du site, pas par IfcMapConversion (conversion nulle, site placé à de grandes coordonnées).', req: { kind: 'geo', key: 'site.position' } })
  } else if (mcIsZero) {
    checks.push({ level: 'warn', text: 'IfcMapConversion nulle : l’origine du modèle coïncide avec celle du système projeté.', req: { kind: 'geo', key: 'mc.eastings' } })
  } else {
    checks.push({ level: 'ok', text: 'Géoréférencement porté par IfcMapConversion.', req: { kind: 'geo', key: 'mc.eastings' } })
  }
  if (result && geolocation?.elevation != null) {
    const gap = geolocation.elevation - result.z
    checks.push(
      Math.abs(gap) > ELEVATION_TOLERANCE
        ? { level: 'warn', text: `Écart d’altitude : RefElevation ${fmt(geolocation.elevation, 3)} m ≠ Z calculé ${fmt(result.z, 3)} m (${gap > 0 ? '+' : ''}${fmt(gap, 3)} m).`, req: { kind: 'geo', key: 'geo.elevation' } }
        : { level: 'ok', text: `RefElevation cohérente avec le Z calculé (écart ${fmt(Math.abs(gap), 3)} m).`, req: { kind: 'geo', key: 'geo.elevation' } }
    )
  }
  if (!geolocation || (geolocation.latitude === null && geolocation.longitude === null)) {
    checks.push({ level: 'info', text: 'Latitude/longitude non renseignées sur l’IfcSite.' })
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
      <Section title="Projet">
        <Row label="Nom" value={projectInfo.projectName} req={{ kind: 'project', field: 'project.Name' }} />
        <Row label="Désignation" value={projectInfo.projectLongName} req={{ kind: 'project', field: 'project.LongName' }} />
        <Row label="Phase" value={projectInfo.projectPhase} req={{ kind: 'project', field: 'project.Phase' }} />
        <Row label="Bâtiment" value={projectInfo.buildingName} req={{ kind: 'project', field: 'building.Name' }} />
        <Row label="Schéma" value={projectInfo.schema} req={{ kind: 'project', field: 'schema' }} />
        <Row label="MVD" value={projectInfo.mvd} req={{ kind: 'project', field: 'mvd' }} />
      </Section>

      <Section title="Site">
        <Row label="Nom" value={projectInfo.siteName} req={{ kind: 'project', field: 'site.Name' }} />
        <Row label="Adresse" value={projectInfo.siteAddress} req={{ kind: 'project', field: 'site.Address' }} />
      </Section>

      {/* 1. Géoréférencement au sens IFC : IfcProjectedCRS + IfcMapConversion. */}
      <Section title="Géoréférencement" source="IfcProjectedCRS + IfcMapConversion" accent>
        {georeference?.crs ? (
          <>
            <Row label="Système" value={georeference.crs.name} req={{ kind: 'geo', key: 'crs.name' }} />
            <Row label="Description" value={georeference.crs.description} req={{ kind: 'geo', key: 'crs.description' }} />
            <Row label="Datum géodésique" value={georeference.crs.geodeticDatum} req={{ kind: 'geo', key: 'crs.geodeticDatum' }} />
            <Row label="Datum vertical" value={georeference.crs.verticalDatum} req={{ kind: 'geo', key: 'crs.verticalDatum' }} />
            <Row label="Projection" value={georeference.crs.mapProjection} req={{ kind: 'geo', key: 'crs.mapProjection' }} />
            <Row label="Zone" value={georeference.crs.mapZone} req={{ kind: 'geo', key: 'crs.mapZone' }} />
            <Row label="Unité" value={georeference.crs.mapUnit} req={{ kind: 'geo', key: 'crs.mapUnit' }} />
          </>
        ) : (
          <Empty>Aucun système de coordonnées (IfcProjectedCRS)</Empty>
        )}
        <p className="pt-1.5 text-[10px] uppercase tracking-wider text-amber-400/80">Point d'ancrage de l'origine du modèle</p>
        {mc ? (
          <>
            <Row label="Eastings (E)" value={fmt(mc.eastings)} req={{ kind: 'geo', key: 'mc.eastings' }} />
            <Row label="Northings (N)" value={fmt(mc.northings)} req={{ kind: 'geo', key: 'mc.northings' }} />
            <Row label="Hauteur orth. (H)" value={fmt(mc.orthogonalHeight)} req={{ kind: 'geo', key: 'mc.orthogonalHeight' }} />
            <Row label="Rotation" value={`${fmt(mc.rotation)}°`} req={{ kind: 'geo', key: 'mc.rotation' }} />
            <Row label="Échelle" value={fmt(mc.scale, 0)} req={{ kind: 'geo', key: 'mc.scale' }} />
            {mcIsZero && (
              <Warn>Conversion nulle : l'origine du modèle est déjà en coordonnées {georeference?.crs?.name ?? 'projetées'} — voir Contrôles.</Warn>
            )}
          </>
        ) : (
          <Empty>
            {projectInfo.schema === 'IFC2X3'
              ? 'IfcMapConversion inexistant en IFC2x3 (introduit en IFC4) : modèle non géoréférencé au sens IFC4'
              : 'Aucun IfcMapConversion : modèle non géoréférencé'}
          </Empty>
        )}
      </Section>

      {/* 2. Résultat calculé : géoréférencement appliqué au placement du site. */}
      <Section
        title={georeference?.crs?.name ? `Coordonnées du site en ${georeference.crs.name}` : 'Coordonnées du site (calculées)'}
        source={mc ? 'calcul : placement du site → IfcMapConversion' : 'placement du site, sans conversion'}
      >
        {result ? (
          <>
            <Row label="X" value={fmt(result.x, 2)} req={{ kind: 'geo', key: 'site.result' }} />
            <Row label="Y" value={fmt(result.y, 2)} req={{ kind: 'geo', key: 'site.result' }} />
            <Row label="Z" value={fmt(result.z, 2)} req={{ kind: 'geo', key: 'site.result' }} />
            <p className="text-[10px] text-gray-500 leading-snug pt-0.5">
              Valeur calculée par l'application (c'est celle que montre Solibri), pas une donnée écrite telle quelle dans le fichier.
            </p>
          </>
        ) : (
          <Empty>Placement de l'IfcSite absent</Empty>
        )}
      </Section>

      {/* 3. Placement local : pas un géoréférencement. */}
      <Section title="Placement du site dans le modèle" source="IfcSite.ObjectPlacement → IfcCartesianPoint" defaultOpen={false}>
        {georeference?.sitePosition ? (
          <>
            <Row label="X" value={fmt(georeference.sitePosition.x, 2)} req={{ kind: 'geo', key: 'site.position' }} />
            <Row label="Y" value={fmt(georeference.sitePosition.y, 2)} req={{ kind: 'geo', key: 'site.position' }} />
            <Row label="Z" value={fmt(georeference.sitePosition.z, 2)} req={{ kind: 'geo', key: 'site.position' }} />
            <p className="text-[10px] text-gray-500 leading-snug pt-0.5">
              Position locale du site dans le repère du modèle — pas un géoréférencement.
            </p>
          </>
        ) : (
          <Empty>Placement de l'IfcSite absent</Empty>
        )}
      </Section>

      {/* 4. Géolocalisation WGS84, descriptive. */}
      <Section title="Géolocalisation" source="IfcSite.RefLatitude / RefLongitude / RefElevation">
        {geolocation && (geolocation.latitude !== null || geolocation.longitude !== null) ? (
          <>
            <Row label="Latitude" value={geolocation.latitudeDms} req={{ kind: 'geo', key: 'geo.latitude' }} />
            <Row label="Longitude" value={geolocation.longitudeDms} req={{ kind: 'geo', key: 'geo.longitude' }} />
            <Row
              label="Décimal"
              value={`${geolocation.latitude?.toFixed(6)}° ; ${geolocation.longitude?.toFixed(6)}°`}
              req={{ kind: 'geo', key: 'geo.latitude' }}
            />
            <Row label="Altitude (RefElevation)" value={fmt(geolocation.elevation, 2)} req={{ kind: 'geo', key: 'geo.elevation' }} />
            <p className="text-[10px] text-gray-500 leading-snug pt-0.5">
              Coordonnées WGS84 descriptives : elles ne servent pas au placement (seule méthode en IFC2x3).
            </p>
          </>
        ) : (
          <Empty>Latitude/longitude non renseignées</Empty>
        )}
      </Section>

      {/* 5. Orientation. */}
      <Section title="Orientation" source="IfcGeometricRepresentationContext.TrueNorth">
        <Row
          label="Nord vrai"
          value={georeference?.trueNorth != null ? `${fmt(georeference.trueNorth)}°` : null}
          req={{ kind: 'geo', key: 'trueNorth' }}
        />
        {georeference?.trueNorth == null && <Empty>TrueNorth non renseigné</Empty>}
      </Section>

      {/* Contrôles de cohérence. */}
      <Section title={`Contrôles — ${checks.filter((c) => c.level === 'warn').length} alerte${checks.filter((c) => c.level === 'warn').length > 1 ? 's' : ''}`}>
        {checks.map((c, i) => (
          <div key={i} className="flex gap-1.5 py-0.5 leading-snug">
            <span className={c.level === 'warn' ? 'text-amber-400' : c.level === 'ok' ? 'text-emerald-400' : 'text-gray-500'}>
              {c.level === 'warn' ? '⚠' : c.level === 'ok' ? '✓' : 'ℹ'}
            </span>
            <span className="text-gray-300 min-w-0">
              {c.req ? <IfcLink request={c.req}>{c.text}</IfcLink> : c.text}
            </span>
          </div>
        ))}
      </Section>

      <Section title={`Étages — ${projectInfo.storeys.length}`}>
        {projectInfo.storeys.length === 0 ? (
          <p className="text-gray-700 italic">Aucun étage</p>
        ) : (
          projectInfo.storeys.map((s, i) => (
            <Row
              key={i}
              label={s.name ?? `Étage ${i + 1}`}
              value={s.elevation != null ? `${fmt(s.elevation, 2)} m` : '—'}
              req={{ kind: 'project', field: 'storey', id: s.id }}
            />
          ))
        )}
      </Section>

      <Section title="Logiciel & historique" defaultOpen={false}>
        <Row label="Application" value={ownerHistory?.applicationName} req={{ kind: 'project', field: 'owner.application' }} />
        <Row label="Version" value={ownerHistory?.applicationVersion} req={{ kind: 'project', field: 'owner.version' }} />
        <Row label="Éditeur" value={ownerHistory?.applicationDeveloper} req={{ kind: 'project', field: 'owner.developer' }} />
        <Row label="Auteur" value={ownerHistory?.personName} req={{ kind: 'project', field: 'owner.person' }} />
        <Row label="Organisation" value={ownerHistory?.organizationName} req={{ kind: 'project', field: 'owner.organization' }} />
        <Row label="Créé le" value={ownerHistory?.creationDate} req={{ kind: 'project', field: 'owner.creationDate' }} />
        <Row label="Modifié le" value={ownerHistory?.lastModifiedDate} req={{ kind: 'project', field: 'owner.lastModifiedDate' }} />
        {!ownerHistory && <p className="text-gray-700 italic">IfcOwnerHistory absent</p>}
      </Section>

      <Section title={`Unités — ${projectInfo.units.length}`} defaultOpen={false}>
        {projectInfo.units.length === 0 ? (
          <p className="text-gray-700 italic">Aucune unité déclarée</p>
        ) : (
          projectInfo.units.map((u, i) => (
            <p key={i} className="text-gray-300 py-0.5">
              <IfcLink request={{ kind: 'project', field: 'unit', id: u.id }}>{u.label}</IfcLink>
            </p>
          ))
        )}
      </Section>
    </div>
  )
}
