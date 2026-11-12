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
  children,
  defaultOpen = true,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-800 bg-gray-900/40">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-gray-800/50 transition-colors"
      >
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{title}</span>
        <span className="text-gray-700 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-2.5 pb-2 pt-0.5 text-xs space-y-0.5">{children}</div>}
    </div>
  )
}

const fmt = (v: number | null | undefined, digits = 3) =>
  v === null || v === undefined ? null : (Object.is(v, -0) || Math.abs(v) < 5 * 10 ** -(digits + 1) ? 0 : v).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })

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

      <Section title="Géolocalisation">
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
          </>
        ) : (
          <Empty>Latitude/longitude non renseignées (IfcSite.RefLatitude / RefLongitude)</Empty>
        )}
      </Section>

      <Section title="Géoréférencement">
        {georeference ? (
          <>
            {georeference.crs ? (
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

            {/* Résultat : ce que l'utilisateur cherche (et ce que Solibri affiche en coordonnées globales). */}
            {(() => {
              const mc = georeference.mapConversion
              const result = mc ? georeference.projectedPosition : georeference.sitePosition
              const target = georeference.crs?.name ?? (mc ? 'le système projeté' : null)
              return (
                <div className="mt-2 mb-1 border border-amber-800/60 bg-amber-950/20 px-2 py-1.5">
                  <p className="text-[10px] uppercase tracking-wider text-amber-400/90 mb-0.5">
                    {target ? `Coordonnées du site dans ${target}` : 'Coordonnées du site'}
                  </p>
                  {result ? (
                    <>
                      <Row label="X" value={fmt(result.x, 2)} req={{ kind: 'geo', key: 'site.result' }} />
                      <Row label="Y" value={fmt(result.y, 2)} req={{ kind: 'geo', key: 'site.result' }} />
                      <Row label="Z" value={fmt(result.z, 2)} req={{ kind: 'geo', key: 'site.result' }} />
                      {!mc && (
                        <p className="text-[10px] text-gray-500 leading-snug pt-0.5">
                          Sans IfcMapConversion, ce sont les coordonnées du repère du modèle.
                        </p>
                      )}
                    </>
                  ) : (
                    <Empty>Placement de l'IfcSite absent</Empty>
                  )}
                </div>
              )
            })()}

            <p className="pt-2 text-[10px] uppercase tracking-wider text-gray-400">Détail du calcul</p>
            <p className="text-[10px] text-gray-500 leading-snug pb-0.5">
              ① position dans le repère du modèle, passée dans ② la conversion = coordonnées ci-dessus.
            </p>
            <Row label="Origine (Revit)" value={projectInfo.coordinateBase} req={{ kind: 'project', field: 'coordinateBase' }} />

            <p className="pt-1.5 text-[10px] uppercase tracking-wider text-gray-500">① Position dans le repère du modèle</p>
            {georeference.sitePosition ? (
              <>
                <Row label="X" value={fmt(georeference.sitePosition.x, 2)} req={{ kind: 'geo', key: 'site.position' }} />
                <Row label="Y" value={fmt(georeference.sitePosition.y, 2)} req={{ kind: 'geo', key: 'site.position' }} />
                <Row label="Z" value={fmt(georeference.sitePosition.z, 2)} req={{ kind: 'geo', key: 'site.position' }} />
              </>
            ) : (
              <Empty>Placement de l'IfcSite absent</Empty>
            )}

            <p className="pt-1.5 text-[10px] uppercase tracking-wider text-gray-500">② Conversion (IfcMapConversion)</p>
            {georeference.mapConversion ? (
              <>
                <Row label="Eastings (X)" value={fmt(georeference.mapConversion.eastings)} req={{ kind: 'geo', key: 'mc.eastings' }} />
                <Row label="Northings (Y)" value={fmt(georeference.mapConversion.northings)} req={{ kind: 'geo', key: 'mc.northings' }} />
                <Row label="Hauteur orth. (Z)" value={fmt(georeference.mapConversion.orthogonalHeight)} req={{ kind: 'geo', key: 'mc.orthogonalHeight' }} />
                <Row label="Rotation" value={`${fmt(georeference.mapConversion.rotation)}°`} req={{ kind: 'geo', key: 'mc.rotation' }} />
                <Row label="Échelle" value={fmt(georeference.mapConversion.scale, 0)} req={{ kind: 'geo', key: 'mc.scale' }} />
              </>
            ) : (
              <Empty>
                {projectInfo.schema === 'IFC2X3'
                  ? 'Inexistant en IFC2x3 (introduit en IFC4)'
                  : 'Aucun IfcMapConversion dans le fichier'}
              </Empty>
            )}

            <p className="pt-2 text-[10px] uppercase tracking-wider text-gray-400">Orientation</p>
            <Row
              label="Nord vrai"
              value={georeference.trueNorth !== null ? `${fmt(georeference.trueNorth)}°` : null}
              req={{ kind: 'geo', key: 'trueNorth' }}
            />
          </>
        ) : (
          <Empty>Aucune donnée de géoréférencement</Empty>
        )}
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
