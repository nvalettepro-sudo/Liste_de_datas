import type { IfcAPI } from 'web-ifc'
import { splitStepLine } from './step'

export type Rec = Record<string, unknown>

/**
 * Accès minimal au modèle, commun au worker et aux tests : web-ifc pour les
 * entités qu'il connaît, et le texte brut pour l'en-tête et pour les entités
 * IFC4.3 que cette version de web-ifc ne décode pas (IfcMapConversionScaled,
 * IfcRigidOperation, IfcGeographicCRS, IfcWellKnownText).
 */
export interface IfcReader {
  ids(typeCode: number): number[]
  line(id: number | null | undefined): Rec | null
  typeName(id: number): string | null
  /** Début du fichier (section HEADER). */
  header: string
  /** Instances dont le type figure dans `types` (noms STEP en majuscules), lues dans le texte brut. */
  rawScan(types: string[]): { id: number; type: string; args: string[] }[]
}

export function createIfcReader(api: IfcAPI, modelId: number, bytes: Uint8Array): IfcReader {
  const decoder = new TextDecoder('utf-8', { fatal: false })
  return {
    ids(typeCode) {
      try {
        const v = api.GetLineIDsWithType(modelId, typeCode)
        const out: number[] = []
        for (let i = 0; i < v.size(); i++) out.push(v.get(i))
        return out
      } catch {
        return []
      }
    },
    line(id) {
      if (id === null || id === undefined) return null
      try {
        return (api.GetLine(modelId, id, false) as Rec) ?? null
      } catch {
        return null
      }
    },
    typeName(id) {
      try {
        const l = api.GetLine(modelId, id, false) as Rec
        return l ? api.GetNameFromTypeCode(l.type as number) ?? null : null
      } catch {
        return null
      }
    },
    header: decoder.decode(bytes.subarray(0, Math.min(bytes.length, 16384))),
    rawScan(types) {
      // Recherche d'octets plutôt que décodage complet : ces entités sont rares
      // et le fichier peut peser plusieurs centaines de Mo.
      const out: { id: number; type: string; args: string[] }[] = []
      for (const t of types) {
        const needle = new TextEncoder().encode(`=${t}(`)
        let from = 0
        for (;;) {
          const at = indexOfBytes(bytes, needle, from)
          if (at < 0) break
          from = at + needle.length
          // Remonte jusqu'au '#' de début d'instruction.
          let s = at - 1
          while (s >= 0 && bytes[s] !== 35 && bytes[s] !== 10 && bytes[s] !== 59) s--
          if (s < 0 || bytes[s] !== 35) continue
          let e = at
          let inStr = false
          while (e < bytes.length) {
            if (bytes[e] === 39) inStr = !inStr
            else if (bytes[e] === 59 && !inStr) break
            e++
          }
          const text = decoder.decode(bytes.subarray(s, e + 1)).replace(/\s*[\r\n]+\s*/g, ' ')
          const id = Number(text.slice(1, text.indexOf('=')).trim())
          const parts = splitStepLine(text)
          if (parts && Number.isFinite(id)) out.push({ id, type: t, args: parts.args })
        }
      }
      return out
    },
  }
}

function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from: number): number {
  const first = needle[0]
  const last = hay.length - needle.length
  for (let i = hay.indexOf(first, from); i >= 0 && i <= last; i = hay.indexOf(first, i + 1)) {
    let j = 1
    while (j < needle.length && hay[i + j] === needle[j]) j++
    if (j === needle.length) return i
  }
  return -1
}
