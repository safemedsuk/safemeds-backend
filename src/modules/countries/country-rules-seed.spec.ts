import {
  AUTHORITIES,
  KENYA_ADR_REPORTING_RULE_CANDIDATES,
  KENYA_DEVICE_INCIDENT_REPORTING_RULES,
  KENYA_FORM_SCHEMAS,
  KENYA_SUBMISSION_FORMATS,
  KENYA_UNVERIFIED_REPORTING_RULE_CANDIDATES,
  REPORT_TYPES,
} from '../../../prisma/country-rules.seed-data'

describe('country-rules seed data consistency', () => {
  const reportTypeKeys = new Set(REPORT_TYPES.map((r) => r.typeKey))
  // The six official Kenyan PPB/MoH forms this repo digitized directly from
  // the source PDFs — distinct from `reportTypeKeys` (every seeded report
  // type), which as of VigiCloud Stage 13 also includes
  // `clinical_trial_sae`: a genuinely different kind of report type with
  // no PPB form, no form schema, and no PPB/VigiFlow submission format,
  // by design (it reports to an Ethics Committee/trial portal, never PPB —
  // see `CLINICAL_TRIAL_SAE_REPORTING_RULE_CANDIDATES`'s own doc comment).
  // VigiCloud Stage 18 adds a second non-form-based entry, `line_listing`
  // — no case is ever filed against it either; it exists purely so a
  // `ReportingRule` row has somewhere to carry `reportingPeriodDays`
  // (see `REPORT_TYPES`' own doc comment for that entry).
  const KENYA_FORM_BASED_REPORT_TYPE_KEYS = new Set([
    'adr',
    'quality_complaint',
    'medication_error',
    'device_incident',
    'aefi',
    'transfusion_reaction',
  ])

  it("has exactly the six official Kenyan report types, plus VigiCloud Stage 13/14's clinical_trial_sae and Stage 18's line_listing", () => {
    expect(reportTypeKeys).toEqual(
      new Set([...KENYA_FORM_BASED_REPORT_TYPE_KEYS, 'clinical_trial_sae', 'line_listing']),
    )
  })

  it('every KENYA_FORM_SCHEMAS entry references a known report type', () => {
    for (const schema of KENYA_FORM_SCHEMAS) {
      expect(reportTypeKeys.has(schema.reportTypeKey)).toBe(true)
    }
  })

  it('has a form schema for every one of the six Kenyan-PPB-form-based report types — no capture flow silently missing a form', () => {
    const covered = new Set(KENYA_FORM_SCHEMAS.map((f) => f.reportTypeKey))
    expect(covered).toEqual(KENYA_FORM_BASED_REPORT_TYPE_KEYS)
  })

  it('clinical_trial_sae deliberately has no form schema — it is not one of the digitized PPB forms', () => {
    expect(KENYA_FORM_SCHEMAS.some((f) => f.reportTypeKey === 'clinical_trial_sae')).toBe(false)
  })

  it('every form schema section has a key and fields/columns', () => {
    for (const schema of KENYA_FORM_SCHEMAS) {
      const sections = (
        schema.jsonSchema as {
          sections: { key: string; fields?: unknown[]; columns?: unknown[] }[]
        }
      ).sections
      expect(Array.isArray(sections)).toBe(true)
      expect(sections.length).toBeGreaterThan(0)
      for (const section of sections) {
        expect(section.key).toBeTruthy()
        expect(section.fields || section.columns).toBeTruthy()
      }
    }
  })

  it('Q1 is resolved — all 3 ADR reporting rules (fatal/serious/non_serious) are confirmed with the GUD/022 §6.1 windows', () => {
    expect(KENYA_ADR_REPORTING_RULE_CANDIDATES).toHaveLength(3)
    for (const rule of KENYA_ADR_REPORTING_RULE_CANDIDATES) {
      expect(rule.windowDays).toBeGreaterThan(0)
      expect(rule.unverified).toBe(false)
    }
    const byClass = (c: string) =>
      KENYA_ADR_REPORTING_RULE_CANDIDATES.find((r) => r.seriousnessClass === c)
    expect(byClass('fatal')?.windowDays).toBe(7)
    expect(byClass('serious')?.windowDays).toBe(15)
    expect(byClass('non_serious')?.windowDays).toBe(30)
  })

  it('device incident reporting rules are distinct from ADR (2d/30d, not 7d/15d/30d) per GUD/022 §6.5.1', () => {
    expect(KENYA_DEVICE_INCIDENT_REPORTING_RULES).toHaveLength(2)
    for (const rule of KENYA_DEVICE_INCIDENT_REPORTING_RULES) {
      expect(rule.unverified).toBe(false)
    }
    const serious = KENYA_DEVICE_INCIDENT_REPORTING_RULES.find(
      (r) => r.seriousnessClass === 'serious',
    )
    const nonSerious = KENYA_DEVICE_INCIDENT_REPORTING_RULES.find(
      (r) => r.seriousnessClass === 'non_serious',
    )
    expect(serious?.windowDays).toBe(2)
    expect(nonSerious?.windowDays).toBe(30)
  })

  it('quality/medication-error/transfusion-reaction candidates are all unverified — no explicit GUD/022 citation exists for them', () => {
    expect(KENYA_UNVERIFIED_REPORTING_RULE_CANDIDATES.length).toBeGreaterThan(0)
    for (const rule of KENYA_UNVERIFIED_REPORTING_RULE_CANDIDATES) {
      expect(rule.unverified).toBe(true)
    }
    const coveredTypes = new Set(
      KENYA_UNVERIFIED_REPORTING_RULE_CANDIDATES.map((r) => r.reportTypeKey),
    )
    expect(coveredTypes).toEqual(
      new Set(['quality_complaint', 'medication_error', 'transfusion_reaction']),
    )
  })

  it('AEFI routes to NVIP/DHIS2, every other Kenyan-PPB-form-based report type routes to PPB/VigiFlow', () => {
    const aefiFormat = KENYA_SUBMISSION_FORMATS.find((f) => f.reportTypeKey === 'aefi')
    expect(aefiFormat?.authorityCode).toBe('NVIP')
    expect(aefiFormat?.channel).toBe('dhis2')

    const others = KENYA_SUBMISSION_FORMATS.filter((f) => f.reportTypeKey !== 'aefi')
    expect(others.every((f) => f.authorityCode === 'PPB' && f.channel === 'vigiflow')).toBe(true)
  })

  it('has a submission format for every one of the six Kenyan-PPB-form-based report types', () => {
    const covered = new Set(KENYA_SUBMISSION_FORMATS.map((f) => f.reportTypeKey))
    expect(covered).toEqual(KENYA_FORM_BASED_REPORT_TYPE_KEYS)
  })

  it('clinical_trial_sae deliberately has no submission format — no live E2B/VigiFlow gateway; it reports to an Ethics Committee/trial portal instead, evidenced manually like every other stage in this build', () => {
    expect(KENYA_SUBMISSION_FORMATS.some((f) => f.reportTypeKey === 'clinical_trial_sae')).toBe(
      false,
    )
  })

  it('Kenya has PPB, NVIP, and the synthetic ETHICS_COMMITTEE destination authority (AEFI and clinical-trial SAEs are both genuinely different destinations than PPB)', () => {
    const kenyaAuthorities = AUTHORITIES.filter((a) => a.countryIso === 'KE').map((a) => a.code)
    expect(kenyaAuthorities.sort()).toEqual(['ETHICS_COMMITTEE', 'NVIP', 'PPB'])
  })

  it('every authority references a country ISO in the 8-market build-spec list', () => {
    // 'ZW' added QualCloud Stage 10.9 — Zimbabwe/MCAZ, seeded specifically for real recall-rule content.
    const validIsos = new Set(['KE', 'UG', 'TZ', 'RW', 'ET', 'NG', 'ZA', 'GH', 'ZW'])
    for (const authority of AUTHORITIES) {
      expect(validIsos.has(authority.countryIso)).toBe(true)
    }
  })
})
