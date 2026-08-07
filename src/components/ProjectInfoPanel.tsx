import { useState, type ReactNode } from 'react'
import { useStore } from '../store/useStore'

function Row({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="text-gray-500 flex-shrink-0">{label}</span>
      <span className="text-gray-200 text-right break-words">{value}</span>
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

function formatDecimalDegrees(v: number, hemisphere: [string, string]): string {
  const dir = v >= 0 ? hemisphere[0] : hemisphere[1]
  return `${Math.abs(v).toFixed(6)}° ${dir}`
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

  const { georeference, ownerHistory } = projectInfo

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
        {georeference?.latitude != null && (
          <Row label="Latitude" value={formatDecimalDegrees(georeference.latitude, ['N', 'S'])} />
        )}
        {georeference?.longitude != null && (
          <Row label="Longitude" value={formatDecimalDegrees(georeference.longitude, ['E', 'O'])} />
        )}
        {georeference?.elevation != null && (
          <Row label="Altitude" value={georeference.elevation.toFixed(2)} />
        )}
        {!georeference && <p className="text-gray-700 italic">Aucune coordonnée</p>}
      </Section>

      {georeference?.mapConversion && (
        <Section title="Géoréférencement (CRS)" defaultOpen={false}>
          <Row label="Système" value={georeference.mapConversion.crsName} />
          <Row label="Description" value={georeference.mapConversion.crsDescription} />
          <Row label="Datum géodésique" value={georeference.mapConversion.geodeticDatum} />
          <Row label="Datum vertical" value={georeference.mapConversion.verticalDatum} />
          <Row label="Projection" value={georeference.mapConversion.mapProjection} />
          <Row label="Zone" value={georeference.mapConversion.mapZone} />
          <Row label="Est (Eastings)" value={georeference.mapConversion.eastings?.toFixed(3)} />
          <Row label="Nord (Northings)" value={georeference.mapConversion.northings?.toFixed(3)} />
          <Row label="Hauteur orthogonale" value={georeference.mapConversion.orthogonalHeight?.toFixed(3)} />
          <Row
            label="Rotation"
            value={georeference.mapConversion.rotation != null ? `${georeference.mapConversion.rotation.toFixed(3)}°` : null}
          />
          <Row label="Échelle" value={georeference.mapConversion.scale} />
        </Section>
      )}

      <Section title={`Étages — ${projectInfo.storeys.length}`}>
        {projectInfo.storeys.length === 0 ? (
          <p className="text-gray-700 italic">Aucun étage</p>
        ) : (
          projectInfo.storeys.map((s, i) => (
            <Row
              key={i}
              label={s.name ?? `Étage ${i + 1}`}
              value={s.elevation != null ? `${s.elevation.toFixed(2)} m` : '—'}
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
