import { ForbiddenException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'

export type ValidityCriterionKey =
  'identifiable_patient' | 'identifiable_reporter' | 'suspect_product' | 'adverse_event'

export interface ValidityCriterion {
  key: ValidityCriterionKey
  label: string
  met: boolean
}

export interface ValidityGateResult {
  allowed: boolean
  criteria: ValidityCriterion[]
}

const CRITERION_LABELS: Record<ValidityCriterionKey, string> = {
  identifiable_patient: 'Identifiable patient',
  identifiable_reporter: 'Identifiable reporter',
  suspect_product: 'At least one suspect product',
  adverse_event: 'At least one adverse event',
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'PV cases are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * VigiCloud Stage 4 — the four minimum criteria a case needs before it
 * can leave Intake, per Final doc §D: an identifiable patient, an
 * identifiable reporter, at least one suspect product, at least one
 * adverse event. `SuspectProduct`/`AdverseEvent` are effectively
 * guaranteed by `CreatePvCaseDto`'s own `@ArrayMinSize(1)` validation on
 * every real intake path — but "identifiable" patient/reporter is
 * genuinely not guaranteed: a `Reporter`/`Patient` row always exists
 * once a case exists, but every field on it is optional, and a
 * system-channel case (public URL, email, WhatsApp) in particular can
 * easily end up with a reporter/patient row that carries no actual
 * identifying information at all.
 *
 * "Identifiable" here means at least one field that could plausibly let
 * someone follow up — a name, contact detail, or organization for the
 * reporter; initials, a birth date, an age, or a known sex for the
 * patient. This is deliberately generous (any one field is enough) —
 * the gate exists to catch a genuinely empty record, not to demand a
 * complete one.
 */
@Injectable()
export class ValidityGateService {
  constructor(private readonly rls: RlsService) {}

  async evaluate(actor: AuthenticatedUser, caseId: string): Promise<ValidityGateResult> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) => this.evaluateInTx(tx, caseId))
  }

  /** For callers already inside an RLS-bound transaction (e.g. `WorkflowGuardRegistryService`'s guard context) — no re-wrapping, no second transaction. */
  async evaluateInTx(tx: Prisma.TransactionClient, caseId: string): Promise<ValidityGateResult> {
    const [reporter, patient, suspectProductCount, adverseEventCount] = await Promise.all([
      tx.reporter.findFirst({ where: { caseId } }),
      tx.patient.findFirst({ where: { caseId } }),
      tx.suspectProduct.count({ where: { caseId } }),
      tx.adverseEvent.count({ where: { caseId } }),
    ])

    const identifiableReporter = Boolean(
      reporter && (reporter.fullName || reporter.email || reporter.phone || reporter.organization),
    )
    const identifiablePatient = Boolean(
      patient &&
      (patient.initials ||
        patient.dateOfBirth ||
        patient.ageYears !== null ||
        patient.sex !== 'unknown'),
    )

    const criteria: ValidityCriterion[] = [
      {
        key: 'identifiable_patient',
        label: CRITERION_LABELS.identifiable_patient,
        met: identifiablePatient,
      },
      {
        key: 'identifiable_reporter',
        label: CRITERION_LABELS.identifiable_reporter,
        met: identifiableReporter,
      },
      {
        key: 'suspect_product',
        label: CRITERION_LABELS.suspect_product,
        met: suspectProductCount > 0,
      },
      { key: 'adverse_event', label: CRITERION_LABELS.adverse_event, met: adverseEventCount > 0 },
    ]

    return { allowed: criteria.every((c) => c.met), criteria }
  }
}
