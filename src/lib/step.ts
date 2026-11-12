/**
 * Utilitaires de lecture du texte STEP (ISO 10303-21), partagés par le worker,
 * l'analyse de géoréférencement et les tests.
 */

/** Découpe « #id=ENTITY(a,b,(c,d),'e');» en en-tête et arguments de premier niveau. */
export function splitStepLine(line: string): { head: string; args: string[] } | null {
  const open = line.indexOf('(')
  const close = line.lastIndexOf(')')
  if (open < 0 || close < open) return null
  const body = line.slice(open + 1, close)
  const args: string[] = []
  let depth = 0
  let inStr = false
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === "'") inStr = !inStr
    else if (inStr) continue
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) {
      args.push(body.slice(start, i))
      start = i + 1
    }
  }
  args.push(body.slice(start))
  return { head: line.slice(0, open), args }
}

/**
 * Décode les échappements STEP d'une chaîne : \X\HH (ISO-8859-1),
 * \X2\HHHH…\X0\ (UTF-16), \S\c (caractère + 128).
 */
export function decodeStepString(s: string): string {
  return s
    .replace(/\\X2\\((?:[0-9A-F]{4})+)\\X0\\/gi, (_, hex: string) =>
      String.fromCharCode(...(hex.match(/.{4}/g) ?? []).map((h) => parseInt(h, 16)))
    )
    .replace(/\\X\\([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\S\\(.)/g, (_, c: string) => String.fromCharCode(c.charCodeAt(0) + 128))
}

/** Argument STEP brut → nombre ('$' et '*' → null ; IFCREAL(1.) → 1). */
export function parseStepNumber(text: string | undefined): number | null {
  if (text === undefined) return null
  const t = text.trim()
  if (t === '$' || t === '*' || t === '') return null
  const inner = t.match(/^[A-Z0-9_]+\((.*)\)$/i)
  const v = parseFloat(inner ? inner[1] : t)
  return Number.isFinite(v) ? v : null
}

/** Argument STEP brut → référence (#24 → 24). */
export function parseStepRef(text: string | undefined): number | null {
  const m = text?.trim().match(/^#(\d+)$/)
  return m ? Number(m[1]) : null
}

/** Argument STEP brut → chaîne décodée ('abc' → abc ; '$' → null). */
export function parseStepString(text: string | undefined): string | null {
  const m = text?.trim().match(/^'([\s\S]*)'$/)
  return m ? decodeStepString(m[1].replace(/''/g, "'")) : null
}

/** Ligne d'en-tête (FILE_DESCRIPTION, FILE_NAME, FILE_SCHEMA) depuis le début du fichier. */
export function headerArgs(headerText: string, name: string): string[] | null {
  const m = headerText.match(new RegExp(`${name}\\s*\\(([\\s\\S]*?)\\)\\s*;`))
  if (!m) return null
  return splitStepLine(`X(${m[1]})`)?.args ?? null
}
