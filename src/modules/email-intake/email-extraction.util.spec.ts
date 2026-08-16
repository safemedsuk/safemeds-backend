import { extractCaseFields } from './email-extraction.util'

describe('extractCaseFields()', () => {
  it('extracts all fields from a well-labelled email body', () => {
    const text = `
      Reporter Name: Dr. Jane Wanjiru
      Patient Age: 34
      Patient Sex: Female
      Product: Amoxil 500mg
      Adverse Event: Severe rash within two hours of the first dose
    `

    const result = extractCaseFields(text)

    expect(result.reporterName).toBe('Dr. Jane Wanjiru')
    expect(result.reporterIsHealthcareProfessional).toBe(true)
    expect(result.patientAgeYears).toBe(34)
    expect(result.patientSex).toBe('female')
    expect(result.productName).toBe('Amoxil 500mg')
    expect(result.eventTerm).toBe('Severe rash within two hours of the first dose')
    expect(result.missingFields).toEqual([])
  })

  it('accepts a hyphen as the label/value separator, not just a colon', () => {
    const result = extractCaseFields('Age - 40\nSex - Male\nDrug - Panadol\nReaction - Nausea')
    expect(result.patientAgeYears).toBe(40)
    expect(result.patientSex).toBe('male')
    expect(result.productName).toBe('Panadol')
    expect(result.eventTerm).toBe('Nausea')
  })

  it('falls back to patient initials when age/sex are both absent', () => {
    const result = extractCaseFields('Patient Initials: J.M.\nProduct: Panadol\nEvent: Hives')
    expect(result.patientInitials).toBe('J.M')
    expect(result.missingFields).not.toContain('patient information (age, sex, or initials)')
  })

  it('flags all three minimum-criteria fields as missing for an unstructured free-form email', () => {
    const result = extractCaseFields(
      'Hi, I took some medicine yesterday and felt unwell afterwards. Please advise.',
    )

    expect(result.missingFields).toEqual([
      'patient information (age, sex, or initials)',
      'the suspect product or medicine involved',
      'the adverse event or reaction experienced',
    ])
  })

  it('rejects an implausible age (e.g. a phone number fragment matched by the loose "age" label)', () => {
    const result = extractCaseFields('age: 999')
    expect(result.patientAgeYears).toBeNull()
  })

  it('detects a healthcare-professional reporter from context keywords even without an explicit "Reporter Name" label', () => {
    const result = extractCaseFields('This is Dr. Otieno, the attending physician.')
    expect(result.reporterIsHealthcareProfessional).toBe(true)
  })

  it('preserves the full original text as the narrative regardless of what was extracted', () => {
    const text =
      'Product: Panadol\nEvent: Nausea\nSome additional free-form context the reviewer should still see.'
    const result = extractCaseFields(text)
    expect(result.narrative).toBe(text.trim())
  })

  it('handles an empty/undefined body without throwing', () => {
    expect(extractCaseFields('')).toMatchObject({
      missingFields: expect.arrayContaining([expect.any(String)]),
    })
  })
})
