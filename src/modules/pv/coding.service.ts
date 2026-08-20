import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AdverseEvent, SuspectProduct } from '@prisma/client'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CodeAdverseEventDto } from './dto/code-adverse-event.dto'
import { CodeSuspectProductDto } from './dto/code-suspect-product.dto'
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
 * VigiCloud Stage 7 — MedDRA and WHODrug coding. `meddraTermId`/
 * `whoDrugTermId` already existed on `AdverseEvent`/`SuspectProduct`
 * (Stage 1/Stage 7 schema work) with doc comments anticipating exactly
 * this service; this is real reuse, not new modeling. Both dictionaries
 * are global reference data (no `companyId`, no RLS — see
 * `MeddraService`/`WhoDrugService`'s own doc comments), so validating a
 * term exists is a plain lookup on the already-open transaction, not a
 * second RLS-scoped call. Re-coding (assigning a different term to an
 * already-coded event/product — e.g. after a dictionary version bump) is
 * the same call as the first coding, always fully audited with the
 * old→new term id, matching the versioning discipline Stage 7's own
 * build-spec bullet requires: "never silently re-coded... a version bump
 * requires an explicit re-coding action, audited."
 */
@Injectable()
export class CodingService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async codeAdverseEvent(
    actor: AuthenticatedUser,
    caseId: string,
    adverseEventId: string,
    dto: CodeAdverseEventDto,
    meta: RequestMeta,
  ): Promise<AdverseEvent> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.adverseEvent.findFirst({
        where: { id: adverseEventId, caseId, companyId },
      })
      if (!existing) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Adverse event not found on this case',
        })
      }

      const term = await tx.meddraTerm.findUnique({ where: { id: dto.meddraTermId } })
      if (!term) {
        throw new NotFoundException({
          code: 'MEDDRA_TERM_NOT_FOUND',
          message: 'That MedDRA term does not exist',
        })
      }

      const updated = await tx.adverseEvent.update({
        where: { id: adverseEventId },
        data: { meddraTermId: term.id, meddraCodedBy: actor.sub, meddraCodedAt: new Date() },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'pv_adverse_event_coded',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: caseId,
        oldValue: { adverseEventId, meddraTermId: existing.meddraTermId },
        newValue: {
          adverseEventId,
          meddraTermId: term.id,
          meddraTermCode: term.code,
          meddraTermLevel: term.level,
        },
        ip: meta.ip,
      })

      return updated
    })
  }

  async codeSuspectProduct(
    actor: AuthenticatedUser,
    caseId: string,
    suspectProductId: string,
    dto: CodeSuspectProductDto,
    meta: RequestMeta,
  ): Promise<SuspectProduct> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.suspectProduct.findFirst({
        where: { id: suspectProductId, caseId, companyId },
      })
      if (!existing) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Suspect product not found on this case',
        })
      }

      const term = await tx.whoDrugTerm.findUnique({ where: { id: dto.whoDrugTermId } })
      if (!term) {
        throw new NotFoundException({
          code: 'WHODRUG_TERM_NOT_FOUND',
          message: 'That WHODrug term does not exist',
        })
      }

      const updated = await tx.suspectProduct.update({
        where: { id: suspectProductId },
        data: { whoDrugTermId: term.id, whoDrugCodedBy: actor.sub, whoDrugCodedAt: new Date() },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'pv_suspect_product_coded',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: caseId,
        oldValue: { suspectProductId, whoDrugTermId: existing.whoDrugTermId },
        newValue: {
          suspectProductId,
          whoDrugTermId: term.id,
          whoDrugRecordNumber: term.drugRecordNumber,
        },
        ip: meta.ip,
      })

      return updated
    })
  }
}
