import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A recall evidence register is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

export interface RecallEvidenceRow {
  documentId: string
  title: string
  linkedTo: string
  filename: string | null
  sha256: string | null
  uploadedAt: Date | null
}

/**
 * QualCloud (Phase 13) Stage 10.6 — "Evidence reuses the existing
 * `Document`/sha256 pipeline unchanged... the append-only, hash-chained
 * `AuditEvent` requirement is already exactly what `AuditService`'s own
 * `REVOKE UPDATE, DELETE` + trigger-backstop `audit_entry` table
 * provides — no new audit mechanism needed, this stage simply
 * exercises the existing one at real scale." This service does no
 * writing at all — it's a pure, read-only aggregation across every
 * place this build already lets a recall-related document be attached
 * (most as a direct FK, `RecallSubmission.documentId` and similar;
 * some as a generic `Document.recordType`/`recordId` pair, e.g. a
 * plain attachment on the recall itself), so the "Evidence & Audit"
 * screen has one real register instead of a document scattered across
 * a dozen sub-screens.
 */
@Injectable()
export class RecallEvidenceService {
  constructor(private readonly rls: RlsService) {}

  async listEvidence(actor: AuthenticatedUser, recallId: string): Promise<RecallEvidenceRow[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const recall = await tx.recall.findFirst({ where: { id: recallId, companyId } })
      if (!recall) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall not found' })

      const countries = await tx.recallCountry.findMany({ where: { companyId, recallId } })
      const countryIds = countries.map((c) => c.id)

      const [destructionRecords, sightings, quarantineRecords, importJobs, submissions, genericDocs] =
        await Promise.all([
          countryIds.length > 0
            ? tx.recallDestructionRecord.findMany({ where: { companyId, recallCountryId: { in: countryIds } } })
            : Promise.resolve([]),
          tx.recallSighting.findMany({ where: { companyId, recallId } }),
          tx.recallQuarantineRecord.findMany({ where: { companyId, recallId } }),
          tx.recallImportJob.findMany({ where: { companyId, recallId } }),
          countryIds.length > 0
            ? tx.recallSubmission.findMany({ where: { companyId, recallCountryId: { in: countryIds } } })
            : Promise.resolve([]),
          tx.document.findMany({ where: { companyId, recordType: 'recall', recordId: recallId } }),
        ])

      const linkedIds: { documentId: string; linkedTo: string }[] = []
      for (const d of destructionRecords) {
        if (d.disposalApprovalEvidenceId) {
          linkedIds.push({ documentId: d.disposalApprovalEvidenceId, linkedTo: 'Destruction — disposal approval' })
        }
        if (d.certificateEvidenceId) {
          linkedIds.push({ documentId: d.certificateEvidenceId, linkedTo: 'Destruction — certificate' })
        }
      }
      for (const s of sightings) {
        if (s.evidenceDocumentId) {
          linkedIds.push({ documentId: s.evidenceDocumentId, linkedTo: 'Sighting evidence' })
        }
      }
      for (const q of quarantineRecords) {
        for (const docId of q.evidenceDocumentIds) {
          linkedIds.push({ documentId: docId, linkedTo: 'Quarantine evidence' })
        }
      }
      for (const j of importJobs) {
        if (j.documentId) linkedIds.push({ documentId: j.documentId, linkedTo: 'Distribution import file' })
      }
      for (const s of submissions) {
        if (s.documentId) linkedIds.push({ documentId: s.documentId, linkedTo: 'Regulator submission' })
        if (s.submittedProofDocumentId) {
          linkedIds.push({ documentId: s.submittedProofDocumentId, linkedTo: 'Submission proof' })
        }
      }
      for (const d of genericDocs) {
        linkedIds.push({ documentId: d.id, linkedTo: 'Attached to this recall' })
      }

      const uniqueDocumentIds = [...new Set(linkedIds.map((l) => l.documentId))]
      if (uniqueDocumentIds.length === 0) return []

      const documents = await tx.document.findMany({
        where: { id: { in: uniqueDocumentIds }, companyId },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      })
      const documentById = new Map(documents.map((d) => [d.id, d]))

      const rows: RecallEvidenceRow[] = []
      for (const link of linkedIds) {
        const doc = documentById.get(link.documentId)
        if (!doc) continue // a referenced id that doesn't resolve under this company's own RLS scope
        const latestVersion = doc.versions[0]
        rows.push({
          documentId: doc.id,
          title: doc.title,
          linkedTo: link.linkedTo,
          filename: latestVersion?.filename ?? null,
          sha256: latestVersion?.sha256 ?? null,
          uploadedAt: latestVersion?.createdAt ?? null,
        })
      }
      return rows
    })
  }
}
