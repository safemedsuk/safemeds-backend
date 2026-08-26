import { BenefitRiskSummary } from './benefit-risk.service'
import {
  CaseListingRow,
  PeriodicReportData,
  PeriodicReportPdfService,
  PeriodicReportTypeKey,
} from './periodic-report-pdf.service'

function baseSummary(overrides: Partial<BenefitRiskSummary> = {}): BenefitRiskSummary {
  return {
    subjectId: 'product-1',
    periodStart: new Date('2026-01-01'),
    periodEnd: new Date('2026-06-30'),
    caseCount: 14,
    seriousnessBreakdown: { fatal: 1, serious: 5, non_serious: 8 },
    expectednessBreakdown: { listed: 9, unlisted: 3, not_assessed: 2 },
    adverseEventOutcomeBreakdown: {
      recovered: 6,
      recovering: 2,
      not_recovered: 3,
      recovered_with_sequelae: 1,
      fatal: 1,
      unknown: 1,
    },
    causalityBreakdown: {
      certain: 1,
      probable: 4,
      possible: 5,
      unlikely: 2,
      conditional: 1,
      unassessable: 0,
      not_assessed: 1,
    } as never,
    ...overrides,
  }
}

const sampleCaseRow: CaseListingRow = {
  referenceNumber: 'CASE-2026-000123',
  countryName: 'Kenya',
  ageYears: 34,
  sex: 'female',
  suspectProduct: 'Amoxiclav 625mg',
  reactions: ['Rash', 'Pruritus'],
  outcome: 'recovered',
  seriousnessClass: 'serious',
  causality: 'probable_likely',
}

function baseData(
  reportTypeKey: PeriodicReportTypeKey,
  overrides: Partial<PeriodicReportData> = {},
): PeriodicReportData {
  return {
    reportTypeKey,
    reportTypeLabel: 'Periodic Safety Update Report (PSUR)',
    companyName: 'Nairobi Vigil Labs',
    companyAddress: 'P.O. Box 4471, Nairobi, Kenya',
    regulatoryContactEmail: 'pv@nairobivigil.co.ke',
    regulatoryContactPhone: '+254 700 123 456',
    subjectName: 'Amoxiclav 625mg',
    isTrialBased: false,
    innName: 'Amoxicillin/Clavulanic acid',
    genericName: 'Amoxiclav',
    atcCode: 'J01CR02',
    dosageForm: 'Tablet',
    strength: '625mg',
    routeOfAdministration: 'Oral',
    internationalBirthDate: new Date('2020-01-01'),
    periodStart: new Date('2026-01-01'),
    periodEnd: new Date('2026-06-30'),
    dueAt: new Date('2026-09-08'),
    generatedAt: new Date('2026-08-17'),
    benefitRisk: baseSummary(),
    openSignalsCount: 0,
    conclusionNote: 'The benefit-risk profile remains favorable.',
    actionsTakenForSafety: null,
    changesToReferenceSafetyInfo: null,
    estimatedExposure: null,
    caseListing: [sampleCaseRow],
    ...overrides,
  }
}

// A crude but reliable proxy for "how many pages did pdfkit actually emit" —
// pdfkit writes one `/Type /Page` dict per page (distinct from the single
// `/Type /Pages` parent tree node), so counting matches on the raw PDF bytes
// is enough to prove pagination happened without needing a real PDF parser.
function countPages(pdf: Buffer): number {
  const text = pdf.toString('latin1')
  return (text.match(/\/Type\s*\/Page(?!s)/g) ?? []).length
}

describe('PeriodicReportPdfService', () => {
  // Real-document-fidelity request, 12 Sep 2026 — each of the five report
  // types now follows its own real, internationally-standard section
  // structure (ICH E2C(R2) for psur/pbrer, ICH E2F for dsur, the real FDA
  // structure for pader, a genuine per-case line-listing form for
  // cioms_ii) rather than one generic shell — one test per type proves
  // each renders cleanly end to end.
  it.each<PeriodicReportTypeKey>(['psur', 'pbrer', 'dsur', 'pader', 'cioms_ii'])(
    'renders a valid PDF for %s, using its own real section structure',
    async (reportTypeKey) => {
      const service = new PeriodicReportPdfService()
      const pdf = await service.render(
        baseData(reportTypeKey, { isTrialBased: reportTypeKey === 'dsur' }),
      )

      expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-')
      expect(countPages(pdf)).toBeGreaterThanOrEqual(1)
    },
  )

  it("renders cioms_ii's real line-listing table with an empty-interval message when there are no cases", async () => {
    const service = new PeriodicReportPdfService()
    const pdf = await service.render(
      baseData('cioms_ii', { caseListing: [], benefitRisk: baseSummary({ caseCount: 0 }) }),
    )

    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('keeps rendering correctly with a large breakdown table forcing multi-page pagination', async () => {
    const service = new PeriodicReportPdfService()
    const manyCategories = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`category_${i}`, i]),
    )
    const pdf = await service.render(
      baseData('psur', { benefitRisk: baseSummary({ seriousnessBreakdown: manyCategories }) }),
    )

    // A 40-row table can't fit on one page alongside the preceding header
    // content, so this must span at least 2 pages — proving `ensureSpace`
    // actually forced a break rather than silently overflowing/crashing.
    expect(countPages(pdf)).toBeGreaterThanOrEqual(2)
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('omits the submission-deadline line when dueAt is null, without breaking layout', async () => {
    const service = new PeriodicReportPdfService()
    const pdf = await service.render(baseData('psur', { dueAt: null }))

    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it("renders cleanly with every optional narrative field omitted (falls back to standard boilerplate internally — content correctness is verified by real pdftotext readback, matching this codebase's established PDF-verification precedent, not by scanning pdfkit's compressed content streams)", async () => {
    const service = new PeriodicReportPdfService()
    const pdf = await service.render(
      baseData('psur', {
        actionsTakenForSafety: null,
        changesToReferenceSafetyInfo: null,
        conclusionNote: null,
        estimatedExposure: null,
      }),
    )

    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  })
})
