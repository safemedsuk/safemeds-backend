export interface ExtractedEmailCaseFields {
  reporterName: string | null
  reporterIsHealthcareProfessional: boolean
  patientAgeYears: number | null
  patientSex: 'male' | 'female' | null
  patientInitials: string | null
  productName: string | null
  eventTerm: string | null
  narrative: string
  /** Human-readable descriptions of what's missing — surfaced verbatim in the automated follow-up email. Empty means the minimum criteria (patient, product, event — reporter is always identifiable via the sender's own address) are all met. */
  missingFields: string[]
}

const LABEL_PATTERNS = {
  reporterName: /\b(?:reporter\s*name|reported\s*by|your\s*name)\s*[:-]\s*(.+)/i,
  patientAge: /\b(?:patient\s*age|age)\s*[:-]\s*(\d{1,3})/i,
  patientSex: /\b(?:patient\s*sex|sex|gender)\s*[:-]\s*(male|female|m|f)\b/i,
  patientInitials:
    /\b(?:patient\s*initials|initials)\s*[:-]\s*([A-Za-z]{1,4}(?:\.[A-Za-z]{1,4})*)/i,
  productName: /\b(?:product|drug|medicine|medication)(?:\s*name)?\s*[:-]\s*(.+)/i,
  eventTerm: /\b(?:adverse\s*event|reaction|event|side\s*effect|symptom)\s*[:-]\s*(.+)/i,
} as const

const HCP_KEYWORDS = /\b(dr\.?|doctor|pharmacist|nurse|physician|clinician|rph|md)\b/i

/**
 * VigiCloud Stage 3.3 — "scripted extraction of the minimum-criteria
 * fields" (the todo doc's own wording, deliberately not NLP/ML): looks
 * for `Label: value`-shaped lines a structured or semi-structured
 * drug-safety report email would plausibly contain. A free-form email
 * with none of these labels correctly yields all three fields missing —
 * that's the intended trigger for `EmailIntakeService`'s automated
 * follow-up request, not a bug in the extraction.
 */
export function extractCaseFields(emailText: string): ExtractedEmailCaseFields {
  const text = emailText ?? ''

  const reporterName = matchLabel(text, LABEL_PATTERNS.reporterName)
  const ageRaw = matchLabel(text, LABEL_PATTERNS.patientAge)
  const sexRaw = matchLabel(text, LABEL_PATTERNS.patientSex)
  const patientInitials = matchLabel(text, LABEL_PATTERNS.patientInitials)
  const productName = matchLabel(text, LABEL_PATTERNS.productName)
  const eventTerm = matchLabel(text, LABEL_PATTERNS.eventTerm)

  const parsedAge = ageRaw ? Number(ageRaw) : null
  const patientAgeYears =
    parsedAge !== null && parsedAge >= 0 && parsedAge <= 130 ? parsedAge : null
  const patientSex = sexRaw ? normalizeSex(sexRaw) : null

  const missingFields: string[] = []
  if (!patientAgeYears && !patientSex && !patientInitials) {
    missingFields.push('patient information (age, sex, or initials)')
  }
  if (!productName) {
    missingFields.push('the suspect product or medicine involved')
  }
  if (!eventTerm) {
    missingFields.push('the adverse event or reaction experienced')
  }

  return {
    reporterName,
    reporterIsHealthcareProfessional: HCP_KEYWORDS.test(text),
    patientAgeYears,
    patientSex,
    patientInitials,
    productName,
    eventTerm,
    narrative: text.trim(),
    missingFields,
  }
}

function matchLabel(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern)
  if (!match) return null
  const value = match[1].trim().slice(0, 200)
  return value.length > 0 ? value : null
}

function normalizeSex(raw: string): 'male' | 'female' {
  return raw.toLowerCase().startsWith('m') ? 'male' : 'female'
}
