import {
  buildNarrative,
  E2bXmlBuilderService,
  formatE2bDate,
  formatE2bDateTime,
  mapActionTaken,
  mapDrugCharacterization,
  mapPatientSex,
  mapReactionOutcome,
  mapReporterQualification,
  mapReportType,
  yesNo,
} from './e2b-xml-builder.service'
import { SubmissionCaseData } from './regulatory-submission.types'

describe('pure E2B mapping functions', () => {
  it('formatE2bDate — YYYYMMDD, UTC', () => {
    expect(formatE2bDate(new Date('2026-08-09T23:59:59Z'))).toBe('20260809')
  })

  it('formatE2bDateTime — YYYYMMDDHHMMSS, UTC', () => {
    expect(formatE2bDateTime(new Date('2026-08-09T05:06:07Z'))).toBe('20260809050607')
  })

  it('mapReportType — clinical_study is "2", literature is "3", everything else is "1" (spontaneous)', () => {
    expect(mapReportType('clinical_study')).toBe('2')
    expect(mapReportType('literature')).toBe('3')
    expect(mapReportType('form')).toBe('1')
    expect(mapReportType('hotline_phone')).toBe('1')
    expect(mapReportType('whatsapp_qr')).toBe('1')
  })

  it('yesNo — 1=yes, 2=no', () => {
    expect(yesNo(true)).toBe('1')
    expect(yesNo(false)).toBe('2')
  })

  it('mapPatientSex — male=1, female=2, unknown=undefined (omit the element, never guess)', () => {
    expect(mapPatientSex('male')).toBe('1')
    expect(mapPatientSex('female')).toBe('2')
    expect(mapPatientSex('unknown')).toBeUndefined()
  })

  it('mapReactionOutcome covers every ReactionOutcome value with the real ICH E2B codes', () => {
    expect(mapReactionOutcome('recovered')).toBe('1')
    expect(mapReactionOutcome('recovering')).toBe('2')
    expect(mapReactionOutcome('not_recovered')).toBe('3')
    expect(mapReactionOutcome('recovered_with_sequelae')).toBe('4')
    expect(mapReactionOutcome('fatal')).toBe('5')
    expect(mapReactionOutcome('unknown')).toBe('6')
  })

  it('mapDrugCharacterization matches our own enum 1:1', () => {
    expect(mapDrugCharacterization('suspect')).toBe('1')
    expect(mapDrugCharacterization('concomitant')).toBe('2')
    expect(mapDrugCharacterization('interacting')).toBe('3')
  })

  it('mapActionTaken — best-effort keyword match against free text, defaults to "5" (unknown)', () => {
    expect(mapActionTaken('Drug withdrawn')).toBe('1')
    expect(mapActionTaken('Dose reduced')).toBe('2')
    expect(mapActionTaken('Dose increased')).toBe('3')
    expect(mapActionTaken('Not changed')).toBe('4')
    expect(mapActionTaken('Not applicable')).toBe('6')
    expect(mapActionTaken('Something ambiguous')).toBe('5')
    expect(mapActionTaken(null)).toBe('5')
  })

  it('mapReporterQualification — consumer is always "5"; HCP is keyword-matched, defaulting to "3" (other health professional)', () => {
    expect(mapReporterQualification('consumer', 'Pharmacist')).toBe('5')
    expect(mapReporterQualification('healthcare_professional', 'Physician')).toBe('1')
    expect(mapReporterQualification('healthcare_professional', 'Pharmacist')).toBe('2')
    expect(mapReporterQualification('healthcare_professional', 'Lawyer')).toBe('4')
    expect(mapReporterQualification('healthcare_professional', 'Nurse')).toBe('3')
    expect(mapReporterQualification('healthcare_professional', null)).toBe('3')
  })
})

function fixture(overrides: Partial<SubmissionCaseData> = {}): SubmissionCaseData {
  const country = {
    id: 'country-ke',
    isoCode: 'KE',
    name: 'Kenya',
    officialName: 'Republic of Kenya',
    createdAt: new Date(),
  } as SubmissionCaseData['countryOfOccurrence']
  return {
    case: {
      id: 'case-1',
      referenceNumber: 'PV-2026-00042',
      channel: 'form',
      awarenessDate: new Date('2026-08-01'),
      receivedDate: new Date('2026-08-02'),
      countryOfOccurrenceId: 'country-ke',
      countryOfReportId: 'country-ke',
      additionalInformationEncrypted: null,
    } as SubmissionCaseData['case'],
    additionalInformation: 'Patient called back for more detail.',
    reportType: {
      id: 'rt-1',
      typeKey: 'adr',
      name: 'Suspected ADR',
    } as SubmissionCaseData['reportType'],
    countryOfOccurrence: country,
    countryOfReport: country,
    reporter: {
      fullName: 'Jane Wanjiru',
      reporterType: 'healthcare_professional',
      qualification: 'Pharmacist',
      email: null,
      phone: null,
      countryId: null,
      organization: null,
    } as SubmissionCaseData['reporter'],
    patient: {
      initials: 'J.M.',
      ageYears: 34,
      sex: 'female',
      dateOfBirth: null,
      weightKg: null,
      heightCm: null,
      medicalHistory: 'History of penicillin allergy',
    } as SubmissionCaseData['patient'],
    suspectProducts: [
      {
        id: 'sp-1',
        drugCharacterization: 'suspect',
        medicinalProduct: 'Depo-Provera',
        activeSubstanceName: 'Medroxyprogesterone acetate',
        doseText: null,
        startDate: new Date('2026-05-01'),
        endDate: null,
        actionTaken: null,
        route: null,
        obtainedCountry: null,
        whoDrugTerm: null,
      } as SubmissionCaseData['suspectProducts'][number],
    ],
    adverseEvents: [
      {
        id: 'ae-1',
        reportedTerm: 'Severe headache',
        narrative: 'Patient reported a severe headache two days after the injection.',
        onsetDate: new Date('2026-06-11'),
        outcome: 'not_recovered',
        seriousnessDeath: false,
        seriousnessLifeThreatening: false,
        seriousnessHospitalization: true,
        seriousnessDisabling: false,
        seriousnessCongenitalAnomaly: false,
        seriousnessOther: false,
        meddraTerm: {
          code: '10019211',
          level: 'PT',
          name: 'Headache',
          version: { versionLabel: 'MOCK-27.0' },
        } as SubmissionCaseData['adverseEvents'][number]['meddraTerm'],
      } as SubmissionCaseData['adverseEvents'][number],
    ],
    company: {
      name: 'Demo Pharma Ltd',
      registeredAddress: '123 Main St, Nairobi',
      regulatoryContactEmail: 'pv@demopharma.example',
      regulatoryContactPhone: '+254700000000',
      homeCountry: country,
    } as SubmissionCaseData['company'],
    authority: {
      id: 'auth-1',
      code: 'PPB',
      name: 'Pharmacy and Poisons Board',
      formCode: '(FOM001/HPT/VMS/SOP/001)',
      ministryName: 'MINISTRY OF HEALTH',
      poBoxAddress: 'P.O. Box 27663-00506 NAIROBI',
      phone: '+254795743049',
      contactEmail: 'pv@ppb.go.ke',
      emblemAssetKey: 'kenya-coat-of-arms',
    } as SubmissionCaseData['authority'],
    generatedByUserFullName: 'Dr. Regulatory Officer',
    submissionNumber: 1,
    generatedAt: new Date('2026-08-09T10:00:00Z'),
    ...overrides,
  }
}

/** Crude but real well-formedness check — every opening custom tag has a matching closing tag, in balance. */
function assertBalancedTags(xml: string): void {
  const opens = [...xml.matchAll(/<([a-z][a-zA-Z0-9]*)(?:\s[^>]*)?>/g)].map((m) => m[1])
  const closes = [...xml.matchAll(/<\/([a-z][a-zA-Z0-9]*)>/g)].map((m) => m[1])
  const openCounts = new Map<string, number>()
  for (const tag of opens) openCounts.set(tag, (openCounts.get(tag) ?? 0) + 1)
  for (const tag of closes) openCounts.set(tag, (openCounts.get(tag) ?? 0) - 1)
  const unbalanced = [...openCounts.entries()].filter(([, count]) => count !== 0)
  expect(unbalanced).toEqual([])
}

describe('E2bXmlBuilderService.build()', () => {
  const service = new E2bXmlBuilderService()

  it('produces well-formed XML (every tag balanced) for a realistic local case', () => {
    const xml = service.build(fixture())
    assertBalancedTags(xml)
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
  })

  it('carries the real case reference/reporter/product/reaction data into the right tags', () => {
    const xml = service.build(fixture())
    expect(xml).toContain('<primarysourcecountry>KE</primarysourcecountry>')
    expect(xml).toContain('<occurcountry>KE</occurcountry>')
    expect(xml).toContain('<reporterfamilyname>Jane Wanjiru</reporterfamilyname>')
    expect(xml).toContain('<medicinalproduct>Depo-Provera</medicinalproduct>')
    expect(xml).toContain('<drugcharacterization>1</drugcharacterization>')
    expect(xml).toContain('MEDROXYPROGESTERONE ACETATE')
    expect(xml).toContain('<reactionmeddrapt>10019211</reactionmeddrapt>')
    expect(xml).toContain('<reactionoutcome>3</reactionoutcome>') // not_recovered
    expect(xml).toContain('<seriousnesshospitalization>1</seriousnesshospitalization>')
    expect(xml).toContain('<seriousnessdeath>2</seriousnessdeath>')
    expect(xml).toContain('<serious>1</serious>') // any true seriousness flag -> overall serious
  })

  it("builds the receiver identifier from the resolved authority's own country/name — generalizes beyond Kenya", () => {
    const ugCountry = {
      id: 'country-ug',
      isoCode: 'UG',
      name: 'Uganda',
      officialName: null,
      createdAt: new Date(),
    } as SubmissionCaseData['countryOfOccurrence']
    const xml = service.build(
      fixture({
        countryOfOccurrence: ugCountry,
        countryOfReport: ugCountry,
        authority: {
          id: 'auth-2',
          code: 'NDA',
          name: 'National Drug Authority',
          formCode: null,
          ministryName: null,
          poBoxAddress: null,
          phone: null,
          contactEmail: null,
          emblemAssetKey: null,
        } as SubmissionCaseData['authority'],
      }),
    )
    expect(xml).toContain('{HA} Uganda - E2B')
    expect(xml).toContain('<receivercountrycode>UG</receivercountrycode>')
  })

  it('never fabricates a MedDRA/reaction date/version tag when the event is not coded', () => {
    const uncoded = fixture()
    uncoded.adverseEvents = [{ ...uncoded.adverseEvents[0], meddraTerm: null, onsetDate: null }]
    const xml = service.build(uncoded)
    expect(xml).not.toContain('reactionmeddrapt')
    expect(xml).not.toContain('reactionmeddrallt')
    expect(xml).not.toContain('reactionstartdate>')
  })
})

describe('buildNarrative()', () => {
  it("composes a real narrative from the case's own captured fields, not free-typed text", () => {
    const narrative = buildNarrative(fixture())
    expect(narrative).toContain('Depo-Provera')
    expect(narrative).toContain('Severe headache')
    expect(narrative).toContain('Patient called back for more detail.')
  })
})
