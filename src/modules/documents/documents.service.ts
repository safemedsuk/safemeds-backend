import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Document, DocumentVersion, Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { EnvConfig } from '../../config/env.validation'
import { AuditService } from '../audit/audit.service'
import { CreateDocumentUploadDto } from './dto/create-document-upload.dto'
import { StorageService } from './storage.service'

export interface DirectUploadFile {
  buffer: Buffer
  originalname: string
  mimetype: string
}

export interface RequestMeta {
  ip?: string
}

export type DocumentWithVersions = Document & { versions: DocumentVersion[] }

export interface UploadIntent {
  document: Document
  version: DocumentVersion
  uploadUrl: string
  maxSizeBytes: number
}

export interface DirectUploadResult {
  document: Document
  version: DocumentVersion
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Documents are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

function objectKey(
  companyId: string,
  documentId: string,
  version: number,
  filename: string,
): string {
  // Sanitize the filename component only — it's the one piece of this key
  // that's ever user-supplied free text.
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `documents/${companyId}/${documentId}/v${version}/${safeName}`
}

/**
 * Phase 8 — Documents & Storage. `Document` is the logical container (e.g.
 * "Nairobi facility's PSMF"), `DocumentVersion` an actual uploaded file —
 * a new upload always creates a new version, never overwrites one. Upload
 * is normally a two-step handshake: `createUploadIntent()` hands back a
 * presigned PUT URL the client uploads directly to R2 with (no file bytes
 * ever pass through this server), then `complete()` re-downloads the
 * object and hashes it server-side — a client-reported hash is never
 * trusted alone. **This requires the R2 bucket to have CORS configured
 * for the app's origin(s)** — not yet done in this environment (see
 * `CLAUDE.md`'s gotchas list) — so `uploadDirect()` below is the
 * currently-used path from every frontend screen: the file streams
 * through this server (multipart) straight into `StorageService.putObject()`,
 * the same proxy-through-the-backend pattern the pre-existing licence
 * upload (Phase 1.2) already uses successfully, and which never needed
 * CORS for exactly this reason. `createUploadIntent()`/`completeUpload()`
 * remain fully functional (a future large-file/resumable-upload client
 * could still use them once CORS is configured) but are dead code from
 * the UI's perspective until then.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly rls: RlsService,
    private readonly storage: StorageService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  async listForRecord(
    actor: AuthenticatedUser,
    recordType: string,
    recordId: string,
  ): Promise<DocumentWithVersions[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.document.findMany({
        where: { companyId, recordType, recordId },
        include: { versions: { orderBy: { version: 'desc' } } },
        orderBy: { createdAt: 'desc' },
      }),
    )
  }

  /** Shared by `createUploadIntent()` and `uploadDirect()` — resolves which `Document` a new version attaches to (existing vs. brand-new) and what its version number is. Must be called from inside an already-RLS-bound `tx`. */
  private async resolveDocumentForUpload(
    tx: Prisma.TransactionClient,
    companyId: string,
    recordType: string,
    recordId: string,
    actorId: string | null,
    opts: { documentId?: string; title?: string },
  ): Promise<{ document: Document; nextVersion: number }> {
    if (opts.documentId) {
      const existing = await tx.document.findFirst({
        where: { id: opts.documentId, companyId, recordType, recordId },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      })
      if (!existing)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Document not found for this record',
        })
      return { document: existing, nextVersion: (existing.versions[0]?.version ?? 0) + 1 }
    }

    if (!opts.title)
      throw new BadRequestException({
        code: 'TITLE_REQUIRED',
        message: 'title is required when creating a new document',
      })
    const document = await tx.document.create({
      data: { id: newId(), companyId, recordType, recordId, title: opts.title, createdBy: actorId },
    })
    return { document, nextVersion: 1 }
  }

  /**
   * The server-proxied upload path — see this class's own doc comment for
   * why this, not the presigned-URL handshake, is what the UI actually
   * calls. Streams the multipart file straight into R2 via
   * `StorageService.putObject()` (which hashes server-side as part of the
   * same call, same as `completeUpload()`'s re-download does for the
   * other path) and creates the `DocumentVersion` already in its final
   * `stored` state — there is no `pending` window for this path to ever
   * get stuck in.
   */
  async uploadDirect(
    actor: AuthenticatedUser,
    recordType: string,
    recordId: string,
    file: DirectUploadFile,
    opts: { documentId?: string; title?: string },
    meta: RequestMeta,
  ): Promise<DirectUploadResult> {
    const companyId = requireCompany(actor)

    const maxSizeBytes =
      this.configService.get('UPLOAD_MAX_FILE_SIZE_MB', { infer: true }) * 1024 * 1024
    if (file.buffer.byteLength > maxSizeBytes) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: `File must be ${Math.round(maxSizeBytes / (1024 * 1024))}MB or smaller`,
      })
    }

    return this.rls.runAsCompany(companyId, async (tx) => {
      const { document, nextVersion } = await this.resolveDocumentForUpload(
        tx,
        companyId,
        recordType,
        recordId,
        actor.sub,
        opts,
      )

      const key = objectKey(companyId, document.id, nextVersion, file.originalname)
      const putResult = await this.storage.putObject(
        key,
        file.buffer,
        file.mimetype || 'application/octet-stream',
      )

      const version = await tx.documentVersion.create({
        data: {
          id: newId(),
          documentId: document.id,
          version: nextVersion,
          filename: file.originalname,
          contentType: file.mimetype || 'application/octet-stream',
          key,
          status: 'stored',
          sha256: putResult.sha256,
          sizeBytes: putResult.sizeBytes,
          uploadedBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'document_version_stored',
        recordType: 'document',
        recordId: document.id,
        newValue: {
          title: document.title,
          version: nextVersion,
          filename: file.originalname,
          forRecordType: recordType,
          forRecordId: recordId,
          sha256: putResult.sha256,
          sizeBytes: putResult.sizeBytes,
        },
        ip: meta.ip,
      })

      return { document, version }
    })
  }

  /**
   * VigiCloud Stage 3.4 — the same server-proxied upload as
   * `uploadDirect()`, for the one caller with no logged-in human actor at
   * all: `WhatsAppIntakeService` storing a reporter-sent packaging photo
   * against a system-channel `Case`. `createdBy`/`uploadedBy` are `null`
   * — see `Document.createdBy`'s own schema doc comment for why those
   * columns are nullable in the first place.
   */
  async uploadDirectSystem(
    companyId: string,
    recordType: string,
    recordId: string,
    file: DirectUploadFile,
    opts: { documentId?: string; title?: string },
    meta: RequestMeta,
  ): Promise<DirectUploadResult> {
    const maxSizeBytes =
      this.configService.get('UPLOAD_MAX_FILE_SIZE_MB', { infer: true }) * 1024 * 1024
    if (file.buffer.byteLength > maxSizeBytes) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: `File must be ${Math.round(maxSizeBytes / (1024 * 1024))}MB or smaller`,
      })
    }

    return this.rls.runAsCompany(companyId, async (tx) => {
      const { document, nextVersion } = await this.resolveDocumentForUpload(
        tx,
        companyId,
        recordType,
        recordId,
        null,
        opts,
      )

      const key = objectKey(companyId, document.id, nextVersion, file.originalname)
      const putResult = await this.storage.putObject(
        key,
        file.buffer,
        file.mimetype || 'application/octet-stream',
      )

      const version = await tx.documentVersion.create({
        data: {
          id: newId(),
          documentId: document.id,
          version: nextVersion,
          filename: file.originalname,
          contentType: file.mimetype || 'application/octet-stream',
          key,
          status: 'stored',
          sha256: putResult.sha256,
          sizeBytes: putResult.sizeBytes,
          uploadedBy: null,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorType: 'system',
        action: 'document_version_stored',
        recordType: 'document',
        recordId: document.id,
        newValue: {
          title: document.title,
          version: nextVersion,
          filename: file.originalname,
          forRecordType: recordType,
          forRecordId: recordId,
          sha256: putResult.sha256,
          sizeBytes: putResult.sizeBytes,
        },
        ip: meta.ip,
      })

      return { document, version }
    })
  }

  async createUploadIntent(
    actor: AuthenticatedUser,
    recordType: string,
    recordId: string,
    dto: CreateDocumentUploadDto,
    meta: RequestMeta,
  ): Promise<UploadIntent> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const { document, nextVersion } = await this.resolveDocumentForUpload(
        tx,
        companyId,
        recordType,
        recordId,
        actor.sub,
        {
          documentId: dto.documentId,
          title: dto.title,
        },
      )

      const key = objectKey(companyId, document.id, nextVersion, dto.filename)
      const version = await tx.documentVersion.create({
        data: {
          id: newId(),
          documentId: document.id,
          version: nextVersion,
          filename: dto.filename,
          contentType: dto.contentType,
          key,
          status: 'pending',
          uploadedBy: actor.sub,
        },
      })

      const ttl = this.configService.get('PRESIGNED_UPLOAD_TTL_SECONDS', { infer: true })
      const uploadUrl = await this.storage.presignUpload(key, dto.contentType, ttl)
      const maxSizeBytes =
        this.configService.get('UPLOAD_MAX_FILE_SIZE_MB', { infer: true }) * 1024 * 1024

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'document_upload_registered',
        recordType: 'document',
        recordId: document.id,
        newValue: {
          title: document.title,
          version: nextVersion,
          filename: dto.filename,
          forRecordType: recordType,
          forRecordId: recordId,
        },
        ip: meta.ip,
      })

      return { document, version, uploadUrl, maxSizeBytes }
    })
  }

  async completeUpload(
    actor: AuthenticatedUser,
    documentId: string,
    versionId: string,
    meta: RequestMeta,
  ): Promise<DocumentVersion> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const version = await tx.documentVersion.findFirst({
        where: { id: versionId, documentId, document: { companyId } },
      })
      if (!version)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Document version not found' })

      try {
        const verified = await this.storage.verifyObject(version.key)
        const updated = await tx.documentVersion.update({
          where: { id: versionId },
          data: { status: 'stored', sha256: verified.sha256, sizeBytes: verified.sizeBytes },
        })

        await this.auditService.log(tx, {
          companyId,
          actorUserId: actor.sub,
          action: 'document_version_stored',
          recordType: 'document',
          recordId: documentId,
          newValue: {
            version: version.version,
            sha256: verified.sha256,
            sizeBytes: verified.sizeBytes,
          },
          ip: meta.ip,
        })

        return updated
      } catch {
        await tx.documentVersion.update({ where: { id: versionId }, data: { status: 'failed' } })
        await this.auditService.log(tx, {
          companyId,
          actorUserId: actor.sub,
          action: 'document_upload_failed',
          recordType: 'document',
          recordId: documentId,
          newValue: {
            version: version.version,
            reason: 'Object not found in storage or could not be verified',
          },
          ip: meta.ip,
        })
        throw new BadRequestException({
          code: 'UPLOAD_NOT_FOUND',
          message:
            'The uploaded file could not be found or verified — did the upload actually complete?',
        })
      }
    })
  }

  async getDownloadUrl(
    actor: AuthenticatedUser,
    documentId: string,
    versionId: string,
  ): Promise<{ url: string }> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const version = await tx.documentVersion.findFirst({
        where: { id: versionId, documentId, document: { companyId } },
      })
      if (!version)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Document version not found' })
      if (version.status !== 'stored') {
        throw new BadRequestException({
          code: 'VERSION_NOT_STORED',
          message: 'This version has not finished uploading yet',
        })
      }

      const ttl = this.configService.get('PRESIGNED_DOWNLOAD_TTL_SECONDS', { infer: true })
      const url = await this.storage.presignDownload(version.key, ttl)
      return { url }
    })
  }
}
