import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import {
  ProductRegistration,
  RegDossier,
  RegFeeInvoice,
  RegPostMarketObligation,
  RegQuery,
  RegSubmission,
  RegVariation,
} from '@prisma/client'

import { TextEncryptionService } from '../../common/encryption/text-encryption.service'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'The registration archive is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

export interface ArchiveDossierEntry extends RegDossier {
  submissions: RegSubmission[]
  queries: (Omit<RegQuery, 'queryTextEncrypted'> & { queryText: string })[]
  variation: RegVariation | null
}

export interface RegistrationArchive {
  registration: ProductRegistration & { productBrandName: string; authorityName: string }
  dossiers: ArchiveDossierEntry[]
  obligations: (RegPostMarketObligation & { fulfillmentCount: number })[]
  feeInvoices: RegFeeInvoice[]
}

/**
 * RegCloud (Phase 12) Stage 9 — Archive & Custody. Purely a read-only
 * aggregation over data every earlier stage already writes correctly —
 * every dossier ever linked to this registration (the original plus
 * every Stage 7 variation/renewal, since `RegDossierService.create()`
 * always stamps `productRegistrationId` on creation, variation dossiers
 * included — no need to additionally join through `RegVariation`), each
 * with its own submissions/queries, plus the registration's own
 * post-market obligation and fee history. Nothing here writes anything;
 * the "never delete" guarantee this stage's own build-spec text asks to
 * be "confirmed" falls out automatically from `Document`/`RegSubmission`/
 * `RegFeeInvoice`'s own already-established archival conventions — there
 * is no delete path anywhere in this module to begin with.
 */
@Injectable()
export class RegistrationArchiveService {
  constructor(
    private readonly rls: RlsService,
    private readonly encryptionService: TextEncryptionService,
  ) {}

  async getArchive(
    actor: AuthenticatedUser,
    productRegistrationId: string,
  ): Promise<RegistrationArchive> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const registration = await tx.productRegistration.findFirst({
        where: { id: productRegistrationId, companyId },
        include: {
          product: { select: { brandName: true } },
          authority: { select: { name: true } },
        },
      })
      if (!registration)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Product registration not found',
        })

      const dossiers = await tx.regDossier.findMany({
        where: { productRegistrationId, companyId },
        include: {
          regSubmissions: { orderBy: { submissionNumber: 'asc' } },
          regQueries: { orderBy: { receivedDate: 'asc' } },
          regVariation: true,
        },
        orderBy: { createdAt: 'asc' },
      })

      const obligations = await tx.regPostMarketObligation.findMany({
        where: { productRegistrationId, companyId },
        include: { _count: { select: { fulfillments: true } } },
        orderBy: { dueAt: 'asc' },
      })

      const feeInvoices = await tx.regFeeInvoice.findMany({
        where: { productRegistrationId, companyId },
        orderBy: { dueAt: 'asc' },
      })

      return {
        registration: {
          ...registration,
          productBrandName: registration.product.brandName,
          authorityName: registration.authority.name,
        },
        dossiers: dossiers.map((d) => ({
          ...d,
          submissions: d.regSubmissions,
          queries: d.regQueries.map(({ queryTextEncrypted, ...rest }) => ({
            ...rest,
            queryText: this.encryptionService.decrypt(queryTextEncrypted),
          })),
          variation: d.regVariation,
        })),
        obligations: obligations.map(({ _count, ...rest }) => ({
          ...rest,
          fulfillmentCount: _count.fulfillments,
        })),
        feeInvoices,
      }
    })
  }

  /** "Exportable" per the build spec — a plain, generated-live CSV, matching `AuditReadinessService.exportAeLogCsv()`'s own "no stored artifact" precedent. */
  async exportCsv(actor: AuthenticatedUser, productRegistrationId: string): Promise<string> {
    const archive = await this.getArchive(actor, productRegistrationId)
    const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const row = (cells: (string | number)[]) => cells.map((v) => escape(String(v))).join(',')

    const lines: string[] = [row(['Type', 'Date', 'Reference', 'Detail', 'Status'])]
    for (const dossier of archive.dossiers) {
      lines.push(
        row([
          'Dossier',
          dossier.createdAt.toISOString().slice(0, 10),
          dossier.id,
          dossier.variation ? `${dossier.variation.variationType} dossier` : 'Original dossier',
          dossier.status,
        ]),
      )
      for (const submission of dossier.submissions) {
        lines.push(
          row([
            'Submission',
            submission.generatedAt.toISOString().slice(0, 10),
            `#${submission.submissionNumber}`,
            submission.channel,
            submission.dispatchedAt ? 'dispatched' : 'generated',
          ]),
        )
      }
      for (const query of dossier.queries) {
        lines.push(
          row([
            'Query',
            query.receivedDate.toISOString().slice(0, 10),
            query.id,
            query.queryText,
            query.status,
          ]),
        )
      }
    }
    for (const obligation of archive.obligations) {
      lines.push(
        row([
          'Obligation',
          obligation.dueAt.toISOString().slice(0, 10),
          obligation.obligationType,
          `${obligation.fulfillmentCount} fulfillment(s)`,
          obligation.status,
        ]),
      )
    }
    for (const invoice of archive.feeInvoices) {
      lines.push(
        row([
          'Fee',
          invoice.dueAt.toISOString().slice(0, 10),
          invoice.feeType,
          `${invoice.currency} ${invoice.amount.toString()}`,
          invoice.status,
        ]),
      )
    }
    return lines.join('\n')
  }
}
