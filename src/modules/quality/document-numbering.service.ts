import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { SaveDocumentNumberingDto } from './dto/document-numbering.dto'

/**
 * Document numbering engine.
 *
 * Numbers are `{company}{sep}{type}{sep}{year}{sep}{sequence}` in a
 * company-chosen token order. The counter lives in `DocumentNumberSequence`
 * (per company + document type + year) and is incremented by one atomic
 * upsert, so concurrent creates can never receive the same value.
 *
 * Scheme changes (Phase 2 Pass C decision): the counter is keyed by document
 * type and year, never by scheme. Changing initials, token order or the
 * separator mid-year changes only how FUTURE numbers are formatted. Numbers
 * already issued are stored verbatim on their records and never rewritten;
 * the sequence continues from its last value, so nothing is reused or skipped.
 * Two document types can never share a number because type initials must be
 * unique per company (validated on save).
 */

export const DOCUMENT_TYPE_KEYS = [
  'sop',
  'policy',
  'specification_reference',
  'master_batch_record',
  'work_instruction',
  'form',
  'protocol',
  'report',
] as const

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  sop: 'Standard Operating Procedure',
  policy: 'Policy',
  specification_reference: 'Specification (reference)',
  master_batch_record: 'Master Batch Record',
  work_instruction: 'Work Instruction',
  form: 'Form',
  protocol: 'Protocol',
  report: 'Report',
}

export const NUMBERING_TOKENS = ['company', 'type', 'year', 'sequence'] as const
export type NumberingToken = (typeof NUMBERING_TOKENS)[number]
export const NUMBERING_SEPARATORS = ['-', '/', '.', '_'] as const
export const DEFAULT_TOKEN_ORDER: NumberingToken[] = ['company', 'type', 'year', 'sequence']
export const DEFAULT_SEPARATOR = '-'
const COMPANY_SCOPE = 'company'

const LEGAL_SUFFIXES = new Set([
  'ltd',
  'limited',
  'inc',
  'llc',
  'plc',
  'co',
  'company',
  'corp',
  'corporation',
  'the',
  'and',
  'of',
])

export function companyPrefix(companyName: string): string {
  const words = companyName
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !LEGAL_SUFFIXES.has(w.toLowerCase()))
  if (words.length === 0) return 'CO'
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

export function documentTypePrefix(documentType: string): string {
  const words = documentType.split(/[_\s-]+/).filter((w) => w.length > 0)
  if (words.length === 0) return 'DOC'
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

/** Pass A's fixed format, kept as a pure helper for the default scheme. */
export function formatDocumentNumber(
  prefix: string,
  type: string,
  year: number,
  sequence: number,
): string {
  return `${prefix}-${type}-${year}-${String(sequence).padStart(4, '0')}`
}

export function isValidInitials(value: string): boolean {
  return /^[A-Z0-9]{1,10}$/.test(value)
}

export function isValidTokenOrder(value: unknown): value is NumberingToken[] {
  if (!Array.isArray(value) || value.length !== NUMBERING_TOKENS.length) return false
  const set = new Set(value)
  return NUMBERING_TOKENS.every((t) => set.has(t)) && set.size === NUMBERING_TOKENS.length
}

export interface ResolvedScheme {
  companyInitials: string
  companyInitialsIsDefault: boolean
  typeInitials: string
  typeInitialsIsDefault: boolean
  tokenOrder: NumberingToken[]
  separator: string
  /** True when this document type carries its own token order or separator. */
  ownScheme: boolean
}

export interface SchemeRow {
  scope: string
  initials: string | null
  tokenOrder: unknown
  separator: string | null
}

/**
 * Pure resolution of the effective scheme for one document type. Missing
 * rows, null fields and unknown types all fall back to the Pass A default
 * (name-derived company initials, type-derived type initials, year-bearing
 * `company-type-year-sequence` order, `-` separator).
 */
export function resolveScheme(
  rows: SchemeRow[],
  companyName: string,
  documentType: string,
): ResolvedScheme {
  const company = rows.find((r) => r.scope === COMPANY_SCOPE)
  const type = rows.find((r) => r.scope === documentType)
  const companyOrder = isValidTokenOrder(company?.tokenOrder)
    ? company.tokenOrder
    : DEFAULT_TOKEN_ORDER
  const companySeparator =
    company?.separator && (NUMBERING_SEPARATORS as readonly string[]).includes(company.separator)
      ? company.separator
      : DEFAULT_SEPARATOR
  const typeOrder = isValidTokenOrder(type?.tokenOrder) ? type.tokenOrder : null
  const typeSeparator =
    type?.separator && (NUMBERING_SEPARATORS as readonly string[]).includes(type.separator)
      ? type.separator
      : null
  return {
    companyInitials: company?.initials || companyPrefix(companyName),
    companyInitialsIsDefault: !company?.initials,
    typeInitials: type?.initials || documentTypePrefix(documentType),
    typeInitialsIsDefault: !type?.initials,
    tokenOrder: typeOrder ?? companyOrder,
    separator: typeSeparator ?? companySeparator,
    ownScheme: Boolean(typeOrder || typeSeparator),
  }
}

export function buildDocumentNumber(
  scheme: ResolvedScheme,
  year: number,
  sequence: number,
): string {
  const tokens: Record<NumberingToken, string> = {
    company: scheme.companyInitials,
    type: scheme.typeInitials,
    year: String(year),
    sequence: String(sequence).padStart(4, '0'),
  }
  return scheme.tokenOrder.map((t) => tokens[t]).join(scheme.separator)
}

/** A manually typed controlled-document number. */
export function validateManualDocumentNumber(raw: string): string {
  const value = raw.trim()
  if (value.length === 0) {
    throw new BadRequestException({
      code: 'DOCUMENT_NUMBER_REQUIRED',
      message: 'Enter a document number, or leave it blank to let SafeMeds generate one.',
    })
  }
  if (/^\d+$/.test(value)) {
    throw new BadRequestException({
      code: 'DOCUMENT_NUMBER_NUMERIC_ONLY',
      message:
        'A manual document number cannot be digits only (for example 0001). Include a company or type identifier, such as WHO-SOP-0001. System-generated numbers would otherwise begin at 0001.',
    })
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9\-/._]{0,49}$/.test(value)) {
    throw new BadRequestException({
      code: 'DOCUMENT_NUMBER_INVALID',
      message:
        'Use 1 to 50 letters, digits, hyphens, slashes, dots or underscores, starting with a letter or digit.',
    })
  }
  return value
}

/** Transaction-scoped advisory lock per (company, candidate number). `::text` because Prisma cannot deserialize a bare void result. */
async function lockDocumentNumber(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$queryRaw`SELECT (pg_advisory_xact_lock(hashtextextended(${`document_number:${key}`}, 0)))::text AS locked`
}

@Injectable()
export class DocumentNumberingService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Allocates the next number for a document type. Must be called inside an
   * open company-scoped transaction. `isTaken` lets the caller reject a
   * candidate that a manual entry already used; the allocator then advances
   * the sequence (a skipped value is harmless and is never re-issued).
   */
  async allocate(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string
      companyName: string
      documentType: string
      now?: Date
      isTaken?: (candidate: string) => Promise<boolean>
    },
  ): Promise<string> {
    const year = (input.now ?? new Date()).getUTCFullYear()
    const scheme = resolveScheme(
      await this.loadRows(tx, input.companyId),
      input.companyName,
      input.documentType,
    )
    for (let attempt = 0; attempt < 100; attempt++) {
      const sequence = await this.nextSequence(tx, input.companyId, input.documentType, year)
      const candidate = buildDocumentNumber(scheme, year, sequence)
      await lockDocumentNumber(tx, `${input.companyId}:${candidate.toLowerCase()}`)
      if (!input.isTaken || !(await input.isTaken(candidate))) return candidate
    }
    throw new ConflictException({
      code: 'DOCUMENT_NUMBER_EXHAUSTED',
      message: 'Could not find a free document number. Contact support.',
    })
  }

  /**
   * Reserves a manually typed number: non-numeric-only, unique per company
   * case-insensitively. Does NOT touch the sequence counter.
   */
  async reserveManual(
    tx: Prisma.TransactionClient,
    companyId: string,
    raw: string,
    isTaken: (value: string) => Promise<boolean>,
  ): Promise<string> {
    const value = validateManualDocumentNumber(raw)
    await lockDocumentNumber(tx, `${companyId}:${value.toLowerCase()}`)
    if (await isTaken(value)) {
      throw new ConflictException({
        code: 'DOCUMENT_NUMBER_TAKEN',
        message: `The document number "${value}" is already in use. Document numbers are unique per company, ignoring case.`,
      })
    }
    return value
  }

  /** The number the next system-generated document of this type would receive. Read-only. */
  async preview(
    tx: Prisma.TransactionClient,
    companyId: string,
    companyName: string,
    documentType: string,
    now: Date = new Date(),
  ): Promise<string> {
    const year = now.getUTCFullYear()
    const scheme = resolveScheme(await this.loadRows(tx, companyId), companyName, documentType)
    const row = await tx.documentNumberSequence.findUnique({
      where: { companyId_documentType_year: { companyId, documentType, year } },
    })
    return buildDocumentNumber(scheme, year, (row?.lastValue ?? 0) + 1)
  }

  async getConfig(actor: AuthenticatedUser): Promise<unknown> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) => this.buildConfig(tx, companyId))
  }

  /** Builds the response from the caller's own transaction, so a save returns exactly what it just committed. */
  private async buildConfig(tx: Prisma.TransactionClient, companyId: string) {
    const company = await tx.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { name: true },
    })
    const rows = await this.loadRows(tx, companyId)
    const now = new Date()
    const companyScheme = resolveScheme(rows, company.name, '')
    const types = await Promise.all(
      DOCUMENT_TYPE_KEYS.map(async (key) => {
        const scheme = resolveScheme(rows, company.name, key)
        return {
          documentType: key,
          label: DOCUMENT_TYPE_LABELS[key],
          initials: scheme.typeInitials,
          initialsIsDefault: scheme.typeInitialsIsDefault,
          ownScheme: scheme.ownScheme,
          tokenOrder: scheme.tokenOrder,
          separator: scheme.separator,
          nextNumber: await this.preview(tx, companyId, company.name, key, now),
        }
      }),
    )
    return {
      companyInitials: companyScheme.companyInitials,
      companyInitialsIsDefault: companyScheme.companyInitialsIsDefault,
      tokenOrder: companyScheme.tokenOrder,
      separator: companyScheme.separator,
      types,
      tokens: NUMBERING_TOKENS,
      separators: NUMBERING_SEPARATORS,
      yearOfPreview: now.getUTCFullYear(),
    }
  }

  async saveConfig(
    actor: AuthenticatedUser,
    dto: SaveDocumentNumberingDto,
    meta: { ip?: string },
  ): Promise<unknown> {
    const companyId = requireCompany(actor)
    const companyInitials = dto.companyInitials.trim().toUpperCase()
    if (!isValidInitials(companyInitials)) {
      throw new BadRequestException({
        code: 'INITIALS_INVALID',
        message: 'Company initials must be 1 to 10 letters or digits.',
      })
    }
    if (!isValidTokenOrder(dto.tokenOrder)) {
      throw new BadRequestException({
        code: 'TOKEN_ORDER_INVALID',
        message:
          'The token order must include company, type, year and sequence, each exactly once.',
      })
    }
    if (!(NUMBERING_SEPARATORS as readonly string[]).includes(dto.separator)) {
      throw new BadRequestException({
        code: 'SEPARATOR_INVALID',
        message: 'Choose one of the offered separators.',
      })
    }

    return this.rls.runAsCompany(companyId, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { name: true },
      })
      const before = await this.loadRows(tx, companyId)
      const beforeSnapshot = this.snapshot(before, company.name)

      const typeInputs = dto.types ?? []
      for (const t of typeInputs) {
        if (!(DOCUMENT_TYPE_KEYS as readonly string[]).includes(t.documentType)) {
          throw new BadRequestException({
            code: 'DOCUMENT_TYPE_UNKNOWN',
            message: `Unknown document type "${t.documentType}".`,
          })
        }
        if (
          t.initials !== undefined &&
          t.initials !== null &&
          t.initials.trim() !== '' &&
          !isValidInitials(t.initials.trim().toUpperCase())
        ) {
          throw new BadRequestException({
            code: 'INITIALS_INVALID',
            message: `Initials for ${t.documentType} must be 1 to 10 letters or digits.`,
          })
        }
        if (
          t.tokenOrder !== undefined &&
          t.tokenOrder !== null &&
          !isValidTokenOrder(t.tokenOrder)
        ) {
          throw new BadRequestException({
            code: 'TOKEN_ORDER_INVALID',
            message: `Token order for ${t.documentType} is invalid.`,
          })
        }
        if (
          t.separator !== undefined &&
          t.separator !== null &&
          !(NUMBERING_SEPARATORS as readonly string[]).includes(t.separator)
        ) {
          throw new BadRequestException({
            code: 'SEPARATOR_INVALID',
            message: `Separator for ${t.documentType} is invalid.`,
          })
        }
      }

      // Upsert the company row.
      await tx.documentNumberingScheme.upsert({
        where: { companyId_scope: { companyId, scope: COMPANY_SCOPE } },
        create: {
          id: newId(),
          companyId,
          scope: COMPANY_SCOPE,
          initials: companyInitials,
          tokenOrder: dto.tokenOrder,
          separator: dto.separator,
          updatedBy: actor.sub,
        },
        update: {
          initials: companyInitials,
          tokenOrder: dto.tokenOrder,
          separator: dto.separator,
          updatedBy: actor.sub,
        },
      })

      // Upsert one row per submitted document type. Empty inputs clear back
      // to the default; rows are never deleted.
      for (const t of typeInputs) {
        const initials =
          t.initials && t.initials.trim() !== '' ? t.initials.trim().toUpperCase() : null
        await tx.documentNumberingScheme.upsert({
          where: { companyId_scope: { companyId, scope: t.documentType } },
          create: {
            id: newId(),
            companyId,
            scope: t.documentType,
            initials,
            tokenOrder: t.tokenOrder
              ? (t.tokenOrder as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
            separator: t.separator ?? null,
            updatedBy: actor.sub,
          },
          update: {
            initials,
            tokenOrder: t.tokenOrder
              ? (t.tokenOrder as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
            separator: t.separator ?? null,
            updatedBy: actor.sub,
          },
        })
      }

      const after = await this.loadRows(tx, companyId)
      // Type initials must stay unique per company, or two types could issue the same number.
      const seen = new Map<string, string>()
      for (const key of DOCUMENT_TYPE_KEYS) {
        const scheme = resolveScheme(after, company.name, key)
        const clash = seen.get(scheme.typeInitials)
        if (clash) {
          throw new ConflictException({
            code: 'TYPE_INITIALS_DUPLICATE',
            message: `"${scheme.typeInitials}" is used for both ${DOCUMENT_TYPE_LABELS[clash]} and ${DOCUMENT_TYPE_LABELS[key]}. Each document type needs its own initials so their numbers never collide.`,
          })
        }
        seen.set(scheme.typeInitials, key)
      }

      const afterSnapshot = this.snapshot(after, company.name)
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'document_numbering_updated',
        recordType: 'document_numbering_scheme',
        recordId: companyId,
        oldValue: beforeSnapshot,
        newValue: afterSnapshot,
        ip: meta.ip,
      })
      return this.buildConfig(tx, companyId)
    })
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async nextSequence(
    tx: Prisma.TransactionClient,
    companyId: string,
    documentType: string,
    year: number,
  ): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ last_value: number }>>`
      INSERT INTO "document_number_sequence" ("id", "company_id", "document_type", "year", "last_value", "created_at", "updated_at")
      VALUES (${newId()}::uuid, ${companyId}::uuid, ${documentType}, ${year}, 1, NOW(), NOW())
      ON CONFLICT ("company_id", "document_type", "year")
      DO UPDATE SET "last_value" = "document_number_sequence"."last_value" + 1, "updated_at" = NOW()
      RETURNING "last_value"
    `
    return Number(rows[0].last_value)
  }

  private loadRows(tx: Prisma.TransactionClient, companyId: string): Promise<SchemeRow[]> {
    return tx.documentNumberingScheme.findMany({ where: { companyId } })
  }

  private snapshot(rows: SchemeRow[], companyName: string) {
    const company = resolveScheme(rows, companyName, '')
    return {
      companyInitials: company.companyInitials,
      tokenOrder: company.tokenOrder,
      separator: company.separator,
      types: DOCUMENT_TYPE_KEYS.map((key) => {
        const s = resolveScheme(rows, companyName, key)
        return {
          documentType: key,
          initials: s.typeInitials,
          tokenOrder: s.tokenOrder,
          separator: s.separator,
          ownScheme: s.ownScheme,
        }
      }),
    }
  }
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Document numbering is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}
