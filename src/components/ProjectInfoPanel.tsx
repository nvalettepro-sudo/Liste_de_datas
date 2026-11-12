import { useState, type ReactNode } from 'react'
import { useStore } from '../store/useStore'
import { IfcLink } from './IfcLink'
import { GeorefPanel } from './GeorefPanel'
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


export function ProjectInfoPanel() {
  const projectInfo = useStore((s) => s.projectInfo)

  if (!projectInfo) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-gray-700 text-xs italic text-center">Aucune information de projet disponible</p>
      </div>
    )
  }

  const { ownerHistory } = projectInfo
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

      <GeorefPanel g={projectInfo.geo} />

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
