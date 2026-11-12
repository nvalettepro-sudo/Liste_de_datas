/**
 * Jeux de test de la spécification « Géoréférencement IFC » (§10).
 *
 * Les petits fichiers Archicad sont dans tests/fixtures/georef. Les maquettes
 * Revit, trop lourdes pour le dépôt, sont lues dans le dossier indiqué par la
 * variable d'environnement GEOREF_FIXTURES_DIR ; leurs tests sont ignorés si
 * le fichier est absent.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { createIfcReader } from './ifcReader'
import { analyzeGeoreference } from './georef'
import type { GeoAnalysis } from './types'

const here = dirname(fileURLToPath(import.meta.url))
const SMALL = join(here, '../../tests/fixtures/georef')
const LARGE = process.env.GEOREF_FIXTURES_DIR ?? ''

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
})

function analyze(path: string): GeoAnalysis {
  const bytes = new Uint8Array(readFileSync(path))
  const modelId = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false })
  try {
    return analyzeGeoreference(createIfcReader(api, modelId, bytes))
  } finally {
    api.CloseModel(modelId)
  }
}

const near = (a: number | null | undefined, b: number, eps = 1e-3) => expect(Math.abs((a ?? NaN) - b)).toBeLessThan(eps)
const codes = (g: GeoAnalysis) => g.checks.map((c) => c.code)
const large = (name: string) => join(LARGE, name)
const hasLarge = (name: string) => !!LARGE && existsSync(large(name))

describe('Géoréférencement — jeux de test §10', () => {
  it('1. IFC2x3.ifc (Archicad, site à l’origine) → non géoréférencé, mais géolocalisé', () => {
    const g = analyze(join(SMALL, 'IFC2x3.ifc'))
    expect(g.schema).toBe('IFC2X3')
    // La position GPS relève de la géolocalisation, pas du géoréférencement.
    expect(g.status).toBe('AUCUN')
    expect(g.primarySource).toBeNull()
    expect(g.geolocation.located).toBe(true)
    const s = g.sites[0]
    expect(s.stepId).toBe(25)
    expect(s.placement?.pointStepId).toBe(84)
    expect(s.placement?.isZero).toBe(true)
    near(s.refLatitude?.decimal, 48.853402, 1e-6)
    near(s.refLongitude?.decimal, 2.348785, 1e-6)
    expect(s.refLatitude?.dms).toBe(`48° 51' 12,2485" N`)
    expect(s.refLongitude?.dms).toBe(`2° 20' 55,62563" E`)
    expect(s.refElevation).toBe(400)
    expect(codes(g)).toContain('CASE_02_SITE_AT_ORIGIN')
  })

  it('2. IFC2x3_A.ifc (Archicad) → POSITION_LOCALE, X −1 / Y −2 / Z −3', () => {
    const g = analyze(join(SMALL, 'IFC2x3_A.ifc'))
    expect(g.status).toBe('POSITION_LOCALE')
    expect(g.statusCertainty).toBe('VERIFIE_2X3')
    expect(g.primarySource).toBe('SITE_PLACEMENT')
    const p = g.sites[0].placement!
    expect(p.pointStepId).toBe(84)
    expect([p.x, p.y, p.z]).toEqual([-1, -2, -3])
    expect(codes(g)).toContain('PIEGE_01_ARCHICAD_SIGN')
    // Piège 4 : RefElevation 400 m n'est pas l'altitude — information, pas alerte.
    expect(g.checks.find((c) => c.code === 'PIEGE_04_REFELEVATION')?.severity).toBe('info')
  })

  it('IFC4-3.ifc (Archicad, IFC4.3, site à l’origine) → non géoréférencé, mais géolocalisé', () => {
    const g = analyze(join(SMALL, 'IFC4-3.ifc'))
    expect(g.schema).toBe('IFC4X3')
    expect(g.fileSchemaRaw).toBe('IFC4X3_ADD2')
    expect(g.status).toBe('AUCUN')
    expect(g.geolocation.located).toBe(true)
    expect(g.mapConversion).toBeNull()
    expect(codes(g)).toContain('CASE_04_NO_CONVERSION')
  })

  it('5. IFC4-3_A.ifc (Archicad, IFC4.3) → POSITION_LOCALE (cas 4), X −1 / Y −2 / Z −3', () => {
    const g = analyze(join(SMALL, 'IFC4-3_A.ifc'))
    expect(g.status).toBe('POSITION_LOCALE')
    expect(g.statusCertainty).toBe('HYPOTHESE')
    const p = g.sites[0].placement!
    expect(p.pointStepId).toBe(114)
    expect([p.x, p.y, p.z]).toEqual([-1, -2, -3])
    expect(g.context?.trueNorth.isDefault).toBe(false)
    near(g.context?.trueNorth.angleDeg, 0, 1e-9)
  })

  it.skipIf(!hasLarge('DC2002_05_EXE_BIM_014857_01_7403P_IGC_Maquette_GC.ifc'))(
    '4. DC2002_05 (Revit 25.1, IFC2x3) → POSITION_LOCALE + coordonnées projetées',
    () => {
      const g = analyze(large('DC2002_05_EXE_BIM_014857_01_7403P_IGC_Maquette_GC.ifc'))
      expect(g.status).toBe('POSITION_LOCALE')
      const s = g.sites[0]
      expect(s.placement?.pointStepId).toBe(65)
      near(s.placement?.x, 1663853.38, 5e-3)
      near(s.placement?.y, 8180497.35, 5e-3)
      near(s.placement?.z, 23.3, 5e-3)
      near(s.placement?.rotationDeg, 184.66, 5e-3)
      expect(s.refLatitude?.dms).toBe(`48° 49' 24,817501" N`)
      expect(s.refLongitude?.dms).toBe(`2° 30' 27,707985" E`)
      expect(s.refElevation).toBe(0)
      expect(codes(g)).toContain('PIEGE_03_PROJECTED_LOOKING')
    }
  )

  it.skipIf(!hasLarge('test_DC2002_64_EXE_BIM_013795_01_7403P_GXX_CET_CFO_CFA_1.ifc'))(
    '6. test_DC2002_64 (Revit 25.4, IFC4.3, point de base du projet) → GEOREF_COMPLET',
    () => {
      const g = analyze(large('test_DC2002_64_EXE_BIM_013795_01_7403P_GXX_CET_CFO_CFA_1.ifc'))
      expect(g.status).toBe('GEOREF_COMPLET')
      expect(g.primarySource).toBe('MAP_CONVERSION')
      const mc = g.mapConversion!
      expect(mc.stepId).toBe(31)
      expect(mc.sourceContextStepId).toBe(24)
      near(mc.eastings, 1663853.275)
      near(mc.northings, 8180497.627)
      near(mc.orthogonalHeight, 23.258)
      near(mc.rotationDeg, 185.08, 5e-3)
      expect(mc.scale).toBeNull()
      expect(mc.scaleEffective).toBe(1)
      expect(g.crs?.name).toBe('EPSG:3949')
      expect(g.crs?.epsgCode).toBe(3949)
      const s = g.sites[0]
      expect(s.placement?.pointStepId).toBe(70)
      near(s.placement?.z, 0.042)
      near(s.mapPosition?.e, 1663853.275)
      near(s.mapPosition?.n, 8180497.627)
      near(s.mapPosition?.h, 23.3)
      near(g.context?.trueNorth.angleDeg, 174.92, 5e-3)
      expect(codes(g)).toContain('NORTH_ROTATION_CONSISTENT')
      expect(codes(g)).toContain('CASE_17_SCALE_DEFAULT')
    }
  )

  it.skipIf(!hasLarge('DC2002_64_EXE_BIM_013795_01_7403P_GXX_CET_CFO_CFA.ifc'))(
    'DC2002_64 (Revit 25.4, IFC4.3, coordonnées partagées) → GEOREF_IDENTITE',
    () => {
      const g = analyze(large('DC2002_64_EXE_BIM_013795_01_7403P_GXX_CET_CFO_CFA.ifc'))
      expect(g.status).toBe('GEOREF_IDENTITE')
      expect(g.primarySource).toBe('SITE_PLACEMENT')
      expect(g.mapConversion?.isZero).toBe(true)
      expect(g.crs?.name).toBe('EPSG:3949')
      near(g.sites[0].placement?.x, 1663853.275)
      near(g.sites[0].mapPosition?.e, 1663853.275)
      expect(codes(g)).toContain('CASE_05_ZERO_CONVERSION')
      expect(codes(g)).toContain('NORTH_ROTATION_CONSISTENT')
    }
  )
})
