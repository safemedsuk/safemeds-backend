import { readFileSync } from 'fs'
import { join } from 'path'

import { SubmissionCaseData } from './regulatory-submission.types'
import { RegulatorySubmissionPdfService } from './regulatory-submission-pdf.service'

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
    } as SubmissionCaseData['case'],
    additionalInformation: 'Patient called back with more detail about the outcome.',
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
      email: 'jane@example.com',
      phone: '0700000000',
      countryId: null,
      organization: 'Nairobi Clinic',
    } as SubmissionCaseData['reporter'],
    patient: {
      initials: 'J.M.',
      ageYears: 34,
      sex: 'female',
      dateOfBirth: null,
      weightKg: 62,
      heightCm: 165,
      medicalHistory: 'History of penicillin allergy',
    } as SubmissionCaseData['patient'],
    suspectProducts: [
      {
        id: 'sp-1',
        drugCharacterization: 'suspect',
        medicinalProduct: 'Depo-Provera',
        activeSubstanceName: 'Medroxyprogesterone acetate',
        doseText: 'UNK',
        route: 'Intramuscular',
        startDate: new Date('2026-05-01'),
        endDate: null,
        actionTaken: null,
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

describe('RegulatorySubmissionPdfService.render()', () => {
  const service = new RegulatorySubmissionPdfService()

  it('renders a real, non-empty PDF (with the emblem image embedded) for an authority with full letterhead data', async () => {
    const buffer = await service.render(fixture())
    expect(buffer.length).toBeGreaterThan(1000)
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('degrades gracefully to a clean text-only letterhead — never throws — for an authority with no letterhead data sourced yet', async () => {
    const bareAuthority = {
      id: 'auth-2',
      code: 'NDA',
      name: 'National Drug Authority',
      formCode: null,
      ministryName: null,
      poBoxAddress: null,
      phone: null,
      contactEmail: null,
      emblemAssetKey: null,
    } as SubmissionCaseData['authority']
    const buffer = await service.render(fixture({ authority: bareAuthority }))
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('never throws for an unrecognized emblemAssetKey (e.g. seeded but the asset file was never actually added)', async () => {
    const authorityWithMissingAsset = { ...fixture().authority, emblemAssetKey: 'does-not-exist' }
    const buffer = await service.render(fixture({ authority: authorityWithMissingAsset }))
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('handles a case with many adverse events/products across a page break without throwing', async () => {
    const many = fixture()
    many.adverseEvents = Array.from({ length: 40 }, (_, i) => ({
      ...many.adverseEvents[0],
      id: `ae-${i}`,
      reportedTerm: `Adverse event number ${i} with a fairly long descriptive reaction name to force wrapping`,
    }))
    const buffer = await service.render(many)
    expect(buffer.length).toBeGreaterThan(1000)
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  // Real-usage feedback, 19 Aug 2026 — an admin-uploaded emblem
  // (`emblemBuffer`) must render, and must take priority over the
  // bundled `emblemAssetKey` file when both happen to be set.
  it('renders a real, admin-uploaded emblemBuffer directly, even for an authority with no bundled emblemAssetKey at all', async () => {
    const uploadedPng = readFileSync(join(__dirname, 'assets', 'emblems', 'kenya-coat-of-arms.png'))
    const authorityWithNoBundledAsset = { ...fixture().authority, emblemAssetKey: null }
    const buffer = await service.render(
      fixture({ authority: authorityWithNoBundledAsset, emblemBuffer: uploadedPng }),
    )
    expect(buffer.length).toBeGreaterThan(1000)
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })
})
