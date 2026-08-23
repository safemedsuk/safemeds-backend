import {
  AdverseEvent,
  Case,
  Company,
  Country,
  MeddraTerm,
  MeddraVersion,
  Patient,
  RegulatoryAuthority,
  Reporter,
  ReportType,
  SuspectProduct,
  WhoDrugTerm,
  WhoDrugVersion,
} from '@prisma/client'

/**
 * VigiCloud Stage 12 — the one shared, fully-resolved shape both
 * `E2bXmlBuilderService` and `RegulatorySubmissionPdfService` render
 * from. Deliberately its own query/shape (not `PvCaseService.get()`'s
 * frontend-oriented `CaseWithGraph`) — this needs `meddraTerm.version`/
 * `whoDrugTerm.version` nested in for the E2B version fields, which the
 * frontend-facing query never includes.
 */
export interface SubmissionCaseData {
  case: Case
  additionalInformation: string | null
  reportType: ReportType
  countryOfOccurrence: Country
  countryOfReport: Country
  reporter: Reporter | null
  patient: (Patient & { medicalHistory: string | null }) | null
  suspectProducts: (SuspectProduct & {
    whoDrugTerm: (WhoDrugTerm & { version: WhoDrugVersion }) | null
    obtainedCountry: Country | null
  })[]
  adverseEvents: (AdverseEvent & {
    narrative: string
    meddraTerm: (MeddraTerm & { version: MeddraVersion }) | null
  })[]
  company: Company & { homeCountry: Country }
  authority: RegulatoryAuthority
  /**
   * Real-usage feedback, 19 Aug 2026 — the real bytes of
   * `authority.emblemObjectKey` when set, fetched once by the
   * orchestrator (`RegulatorySubmissionService`) *outside* any open
   * transaction (never hold a Postgres transaction across slow, external
   * I/O — the same discipline this module's own PDF-render/R2-upload
   * split already established). `RegulatorySubmissionPdfService` prefers
   * this over the bundled `authority.emblemAssetKey` file whenever set.
   */
  emblemBuffer?: Buffer | null
  generatedByUserFullName: string
  submissionNumber: number
  generatedAt: Date
}
