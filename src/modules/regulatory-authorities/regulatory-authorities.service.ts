import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, RegulatoryAuthority } from '@prisma/client'
import { readdirSync } from 'fs'
import { join } from 'path'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { StorageService } from '../documents/storage.service'
import { CreateRegulatoryAuthorityDto } from './dto/create-regulatory-authority.dto'
import { UpdateRegulatoryAuthorityDto } from './dto/update-regulatory-authority.dto'

export interface RequestMeta {
  ip?: string
}

export interface EmblemUploadFile {
  buffer: Buffer
  originalname: string
  mimetype: string
}

const ALLOWED_EMBLEM_MIME_TYPES = new Set(['image/png', 'image/jpeg'])
const MAX_EMBLEM_BYTES = 2 * 1024 * 1024

/**
 * Admin Configuration Console — Gap 2. Before this module, a new
 * country's `RegulatoryAuthority` could only ever come into existence
 * via a seed-file edit; `GET /countries?configured=true` (what the
 * Country Rules screen's own country picker uses) is itself just "does
 * this country have at least one `RegulatoryAuthority` row," so
 * creating the first one here is the entire mechanism for bringing a
 * new country online — no separate toggle needed.
 *
 * Deliberately plain CRUD, not version-on-write like `ReportingRule`/
 * `SeriousnessDefinition`/etc. — an authority's own identity (name,
 * code, letterhead) doesn't need audit-trailed history the way a *rule*
 * does; its child rules already carry that. Every write is still
 * audited via `AuditService`, matching this domain's own convention.
 */
@Injectable()
export class RegulatoryAuthoritiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly storageService: StorageService,
  ) {}

  async list(countryId?: string): Promise<RegulatoryAuthority[]> {
    return this.prisma.regulatoryAuthority.findMany({
      where: countryId ? { countryId } : undefined,
      orderBy: [{ country: { name: 'asc' } }, { code: 'asc' }],
    })
  }

  /**
   * The bundled, version-controlled emblem image keys actually present
   * in the codebase today — read live from `regulatory-submission`'s
   * own asset directory rather than duplicated as a hardcoded list, so
   * this never drifts from what `RegulatorySubmissionPdfService` can
   * actually render.
   */
  getAvailableEmblemAssetKeys(): string[] {
    const dir = join(__dirname, '..', 'regulatory-submission', 'assets', 'emblems')
    try {
      return readdirSync(dir)
        .filter((f) => f.endsWith('.png'))
        .map((f) => f.replace(/\.png$/, ''))
        .sort()
    } catch {
      return []
    }
  }

  private validateEmblemAssetKey(emblemAssetKey: string | undefined): void {
    if (!emblemAssetKey) return
    const available = this.getAvailableEmblemAssetKeys()
    if (!available.includes(emblemAssetKey)) {
      throw new NotFoundException({
        code: 'EMBLEM_ASSET_NOT_FOUND',
        message: `"${emblemAssetKey}" is not a bundled emblem asset — an engineer must add the image to the codebase first (see assets/emblems/README.md). Available keys: ${available.join(', ') || '(none yet)'}`,
      })
    }
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateRegulatoryAuthorityDto,
    meta: RequestMeta,
  ): Promise<RegulatoryAuthority> {
    this.validateEmblemAssetKey(dto.emblemAssetKey)

    let created: RegulatoryAuthority
    try {
      created = await this.prisma.regulatoryAuthority.create({
        data: {
          id: newId(),
          countryId: dto.countryId,
          code: dto.code,
          name: dto.name,
          formCode: dto.formCode,
          ministryName: dto.ministryName,
          poBoxAddress: dto.poBoxAddress,
          phone: dto.phone,
          contactEmail: dto.contactEmail,
          emblemAssetKey: dto.emblemAssetKey,
        },
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'AUTHORITY_ALREADY_EXISTS',
          message: `An authority with code "${dto.code}" already exists for this country`,
        })
      }
      throw err
    }

    await this.auditService.log(this.prisma, {
      actorUserId: actor.sub,
      action: 'regulatory_authority_created',
      recordType: 'regulatory_authority',
      recordId: created.id,
      newValue: { countryId: dto.countryId, code: dto.code, name: dto.name },
      ip: meta.ip,
    })

    return created
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateRegulatoryAuthorityDto,
    meta: RequestMeta,
  ): Promise<RegulatoryAuthority> {
    const existing = await this.prisma.regulatoryAuthority.findUnique({ where: { id } })
    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Regulatory authority not found' })
    }

    if (dto.emblemAssetKey !== undefined && dto.emblemAssetKey !== '') {
      this.validateEmblemAssetKey(dto.emblemAssetKey)
    }

    let updated: RegulatoryAuthority
    try {
      updated = await this.prisma.regulatoryAuthority.update({
        where: { id },
        data: {
          code: dto.code,
          name: dto.name,
          formCode: dto.formCode,
          ministryName: dto.ministryName,
          poBoxAddress: dto.poBoxAddress,
          phone: dto.phone,
          contactEmail: dto.contactEmail,
          // An empty string is the UI's own signal to clear the field back
          // to null (a plain omitted field means "leave unchanged").
          emblemAssetKey: dto.emblemAssetKey === '' ? null : dto.emblemAssetKey,
        },
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'AUTHORITY_ALREADY_EXISTS',
          message: `An authority with code "${dto.code}" already exists for this country`,
        })
      }
      throw err
    }

    await this.auditService.log(this.prisma, {
      actorUserId: actor.sub,
      action: 'regulatory_authority_updated',
      recordType: 'regulatory_authority',
      recordId: id,
      oldValue: existing,
      newValue: updated,
      ip: meta.ip,
    })

    return updated
  }

  /**
   * Real-usage feedback, 19 Aug 2026 — "by configuration I mean that for
   * any country that image should be uploadable so that even the field
   * expert can handle it. This team has only one engineer." Every other
   * country besides Kenya was permanently stuck on a text-only letterhead
   * until an engineer sourced and committed an image; this is the real
   * per-authority admin-upload path, server-proxied through
   * `StorageService.putObject()` exactly like the pre-existing licence
   * upload (no R2 bucket CORS needed — see that gotcha). No `Document`
   * row: `RegulatoryAuthority` is platform-wide, not company-scoped, so
   * it has no tenant to own one under.
   */
  async uploadEmblem(
    actor: AuthenticatedUser,
    id: string,
    file: EmblemUploadFile,
    meta: RequestMeta,
  ): Promise<RegulatoryAuthority> {
    const existing = await this.prisma.regulatoryAuthority.findUnique({ where: { id } })
    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Regulatory authority not found' })
    }
    if (!ALLOWED_EMBLEM_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException({
        code: 'INVALID_EMBLEM_TYPE',
        message: 'Emblem image must be a PNG or JPEG',
      })
    }
    if (file.buffer.byteLength > MAX_EMBLEM_BYTES) {
      throw new BadRequestException({
        code: 'EMBLEM_TOO_LARGE',
        message: 'Emblem image must be 2MB or smaller',
      })
    }

    const ext = file.mimetype === 'image/png' ? 'png' : 'jpg'
    const key = `regulatory-authorities/${id}/emblem-${Date.now()}.${ext}`
    await this.storageService.putObject(key, file.buffer, file.mimetype)

    const updated = await this.prisma.regulatoryAuthority.update({
      where: { id },
      data: { emblemObjectKey: key },
    })

    await this.auditService.log(this.prisma, {
      actorUserId: actor.sub,
      action: 'regulatory_authority_emblem_uploaded',
      recordType: 'regulatory_authority',
      recordId: id,
      oldValue: { emblemObjectKey: existing.emblemObjectKey },
      newValue: { emblemObjectKey: key, filename: file.originalname },
      ip: meta.ip,
    })

    return updated
  }

  async removeEmblem(
    actor: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<RegulatoryAuthority> {
    const existing = await this.prisma.regulatoryAuthority.findUnique({ where: { id } })
    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Regulatory authority not found' })
    }

    const updated = await this.prisma.regulatoryAuthority.update({
      where: { id },
      data: { emblemObjectKey: null },
    })

    await this.auditService.log(this.prisma, {
      actorUserId: actor.sub,
      action: 'regulatory_authority_emblem_removed',
      recordType: 'regulatory_authority',
      recordId: id,
      oldValue: { emblemObjectKey: existing.emblemObjectKey },
      newValue: { emblemObjectKey: null },
      ip: meta.ip,
    })

    return updated
  }
}
