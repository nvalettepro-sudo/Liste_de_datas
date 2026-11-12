import { useState, type ReactNode } from 'react'
import { useStore } from '../store/useStore'

function Row({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="text-gray-500 flex-shrink-0">{label}</span>
      <span className="text-gray-200 text-right break-all min-w-0">{value}</span>
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
        <Row label="Nom" value={projectInfo.projectName} />
        <Row label="Désignation" value={projectInfo.projectLongName} />
        <Row label="Phase" value={projectInfo.projectPhase} />
        <Row label="Bâtiment" value={projectInfo.buildingName} />
        <Row label="Schéma" value={projectInfo.schema} />
        <Row label="MVD" value={projectInfo.mvd} />
      </Section>

      <Section title="Site">
        <Row label="Nom" value={projectInfo.siteName} />
        <Row label="Adresse" value={projectInfo.siteAddress} />
      </Section>

      <Section title="Géolocalisation">
        {geolocation && (geolocation.latitude !== null || geolocation.longitude !== null) ? (
          <>
            <Row label="Latitude" value={geolocation.latitudeDms} />
            <Row label="Longitude" value={geolocation.longitudeDms} />
            <Row
              label="Décimal"
              value={`${geolocation.latitude?.toFixed(6)}° ; ${geolocation.longitude?.toFixed(6)}°`}
            />
            <Row label="Altitude (RefElevation)" value={fmt(geolocation.elevation, 2)} />
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
                <Row label="Système" value={georeference.crs.name} />
                <Row label="Description" value={georeference.crs.description} />
                <Row label="Datum géodésique" value={georeference.crs.geodeticDatum} />
                <Row label="Datum vertical" value={georeference.crs.verticalDatum} />
                <Row label="Projection" value={georeference.crs.mapProjection} />
                <Row label="Zone" value={georeference.crs.mapZone} />
                <Row label="Unité" value={georeference.crs.mapUnit} />
              </>
            ) : (
              <Empty>Aucun système de coordonnées (IfcProjectedCRS)</Empty>
            )}

            <p className="pt-1.5 text-[10px] uppercase tracking-wider text-gray-500">Position du site (X, Y, Z)</p>
            {georeference.sitePosition ? (
              <>
                <Row label="X" value={fmt(georeference.sitePosition.x, 2)} />
                <Row label="Y" value={fmt(georeference.sitePosition.y, 2)} />
                <Row label="Z" value={fmt(georeference.sitePosition.z, 2)} />
              </>
            ) : (
              <Empty>Placement de l'IfcSite absent</Empty>
            )}

            <p className="pt-1.5 text-[10px] uppercase tracking-wider text-gray-500">Conversion (IfcMapConversion)</p>
            {georeference.mapConversion ? (
              <>
                <Row label="Eastings (X)" value={fmt(georeference.mapConversion.eastings)} />
                <Row label="Northings (Y)" value={fmt(georeference.mapConversion.northings)} />
                <Row label="Hauteur orth. (Z)" value={fmt(georeference.mapConversion.orthogonalHeight)} />
                <Row label="Rotation" value={`${fmt(georeference.mapConversion.rotation)}°`} />
                <Row label="Échelle" value={fmt(georeference.mapConversion.scale, 0)} />
                {georeference.projectedPosition && georeference.sitePosition &&
                  (Math.abs(georeference.projectedPosition.x - georeference.sitePosition.x) > 0.005 ||
                    Math.abs(georeference.projectedPosition.y - georeference.sitePosition.y) > 0.005 ||
                    Math.abs(georeference.projectedPosition.z - georeference.sitePosition.z) > 0.005) && (
                  <>
                    <p className="pt-1.5 text-[10px] uppercase tracking-wider text-gray-500">Site dans le CRS</p>
                    <Row label="X" value={fmt(georeference.projectedPosition.x, 2)} />
                    <Row label="Y" value={fmt(georeference.projectedPosition.y, 2)} />
                    <Row label="Z" value={fmt(georeference.projectedPosition.z, 2)} />
                  </>
                )}
              </>
            ) : (
              <Empty>
                {projectInfo.schema === 'IFC2X3'
                  ? 'Inexistant en IFC2x3 (introduit en IFC4)'
                  : 'Aucun IfcMapConversion dans le fichier'}
              </Empty>
            )}

            <Row
              label="Nord vrai"
              value={georeference.trueNorth !== null ? `${fmt(georeference.trueNorth)}°` : null}
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
            />
          ))
        )}
      </Section>

      <Section title="Logiciel & historique" defaultOpen={false}>
        <Row label="Application" value={ownerHistory?.applicationName} />
        <Row label="Version" value={ownerHistory?.applicationVersion} />
        <Row label="Éditeur" value={ownerHistory?.applicationDeveloper} />
        <Row label="Auteur" value={ownerHistory?.personName} />
        <Row label="Organisation" value={ownerHistory?.organizationName} />
        <Row label="Créé le" value={ownerHistory?.creationDate} />
        <Row label="Modifié le" value={ownerHistory?.lastModifiedDate} />
        {!ownerHistory && <p className="text-gray-700 italic">IfcOwnerHistory absent</p>}
      </Section>

      <Section title={`Unités — ${projectInfo.units.length}`} defaultOpen={false}>
        {projectInfo.units.length === 0 ? (
          <p className="text-gray-700 italic">Aucune unité déclarée</p>
        ) : (
          projectInfo.units.map((u, i) => (
            <p key={i} className="text-gray-300 py-0.5">
              {u.label}
            </p>
          ))
        )}
      </Section>
    </div>
  )
}
