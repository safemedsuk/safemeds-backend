import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Case } from '@prisma/client'

import { TextEncryptionService } from '../../common/encryption/text-encryption.service'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { AssessExpectednessDto } from './dto/assess-expectedness.dto'
import { PV_CASE_RECORD_TYPE, RequestMeta } from './pv-case.service'

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
 * VigiCloud Stage 6 — a manual expectedness/listedness flag, per
 * Reconciliation Note 3: Tier 1 cannot honestly ship automated
 * expectedness comparison against a Company Core Data Sheet that Tier 2's
 * label-version-management feature hasn't built yet, so this is a human
 * judgment call a reviewer records, not a computed one. Callable any
 * number of times — reassessment (a label version changes, or a reviewer
 * revisits an earlier call) is the normal path, matching the same
 * "callable any number of times" shape Stage 5's `TriageService.classify()`
 * already established for this case's other reviewer-set fields.
 *
 * **Gated by `pv.qc_review` (see `PvCaseController`) as of Stage 9** —
 * this used to run on `pv.medical_review` as a documented interim
 * stopgap (Stage 9's real QC-reviewer permission didn't exist yet);
 * Stage 9's own build-spec text says plainly "QC review is where the
 * Stage 6 manual expectedness flag is set," so it moved onto the real
 * `QUALITY_ASSOCIATE`-held permission once Stage 9 built it. Left here
 * as a record of the migration, not a live TODO.
 */
@Injectable()
export class ExpectednessService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly textEncryption: TextEncryptionService,
  ) {}

  async assess(
    actor: AuthenticatedUser,
    caseId: string,
    dto: AssessExpectednessDto,
    meta: RequestMeta,
  ): Promise<Case> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.case.findFirst({ where: { id: caseId, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'PV case not found' })
      }

      const updated = await tx.case.update({
        where: { id: caseId },
        data: {
          expectednessFlag: dto.expectednessFlag,
          expectednessNoteEncrypted: dto.note ? this.textEncryption.encrypt(dto.note) : null,
          expectednessAssessedBy: actor.sub,
          expectednessAssessedAt: new Date(),
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'pv_case_expectedness_assessed',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: caseId,
        oldValue: { expectednessFlag: existing.expectednessFlag },
        newValue: { expectednessFlag: dto.expectednessFlag },
        ip: meta.ip,
      })

      return updated
    })
  }
}
