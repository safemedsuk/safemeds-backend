/**
 * VigiCloud Stage 0.6 — a small, dependency-free RFC-4180-ish CSV parser
 * (quoted fields, embedded commas/newlines, doubled-quote escaping).
 * No `csv-parse`/similar package exists in this repo's dependencies yet,
 * and the format this actually needs to handle (a header row + simple
 * flat rows, as exported by Excel/Google Sheets) doesn't warrant adding
 * one.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const len = text.length

  while (i < len) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += char
      i += 1
      continue
    }

    if (char === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (char === '\r') {
      i += 1
      continue
    }
    if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }
    field += char
    i += 1
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  // Drop fully-blank trailing rows (a lone empty field from a trailing newline).
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

export interface ParsedCsv {
  headers: string[]
  rows: Record<string, string>[]
}

/** Parses a CSV with a header row into `{ headers, rows }`, trimming whitespace on every header and value. */
export function parseCsvToObjects(text: string): ParsedCsv {
  const table = parseCsv(text)
  if (table.length === 0) {
    return { headers: [], rows: [] }
  }

  const [headerRow, ...dataRows] = table
  const headers = headerRow.map((h) => h.trim())

  const rows = dataRows.map((r) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? '').trim()
    })
    return obj
  })

  return { headers, rows }
}
