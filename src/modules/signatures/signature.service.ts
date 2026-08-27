import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, SignatureEvent } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { SignatureTokenService } from '../auth/services/signature-token.service'
import { hashCanonicalPayload } from './canonical-hash.util'

export interface SignInput {
  recordType: string
  recordId: string
  intentStatement: string
  signatureToken: string
  /** Copied onto the row as a string, never looked up live at verify-time — see the schema doc comment. */
  roleAtSigning: string
  /**
   * Stable-key-order-hashed and persisted alongside the hash so `verify()`
   * can recompute it later without depending on the signed record's live,
   * possibly-since-mutated state (see `SignatureEvent.canonicalPayload`'s
   * doc comment in schema.prisma for why this is stored at all).
   */
  canonicalPayload: Record<string, unknown>
}

export interface RequestMeta {
  ip?: string
}

/**
 * Phase 6 — electronic signatures. `sign()` is not exposed as a generic
 * public endpoint (there is deliberately no `POST /signatures` in the build
 * spec) — it's called in-process by whichever domain flow needs a
 * signature-gated action (Phase 5.2's `WorkflowService.transition()` today;
 * future modules the same way), always immediately after that flow itself
 * has already verified the actor holds the right to perform the action.
 * This service's only job is: consume the single-use re-auth token, hash,
 * persist, audit.
 */
@Injectable()
export class SignatureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly signatureTokenService: SignatureTokenService,
  ) {}

  /**
   * Takes an already-open transaction client — exactly like
   * `AuditService.log(tx, entry)` — rather than opening its own, because
   * this is always called from inside a caller's own transaction (Phase
   * 5.2's `WorkflowService.transition()`) where the signature, the state
   * change, and the audit entry must all commit or roll back together.
   * Prisma's `$transaction` callbacks don't nest — a second, independent
   * `this.prisma.$transaction(...)` here would silently break that
   * atomicity guarantee instead of joining the caller's transaction.
   */
  async sign(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    input: SignInput,
    meta: RequestMeta,
  ): Promise<SignatureEvent> {
    if (!actor.companyId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Signing requires a tenant-scoped actor',
      })
    }

    await this.signatureTokenService.consume(input.signatureToken, actor.sub)

    const recordHashSha256 = hashCanonicalPayload(input.canonicalPayload)
    const companyId = actor.companyId

    const created = await tx.signatureEvent.create({
      data: {
        id: newId(),
        companyId,
        recordType: input.recordType,
        recordId: input.recordId,
        recordHashSha256,
        canonicalPayload: input.canonicalPayload as Prisma.InputJsonValue,
        signerId: actor.sub,
        roleAtSigning: input.roleAtSigning,
        intentStatement: input.intentStatement,
        authMethod: 'password_reauth',
      },
    })

    await this.auditService.log(tx, {
      actorUserId: actor.sub,
      companyId,
      action: 'sign',
      recordType: input.recordType,
      recordId: input.recordId,
      newValue: { signatureId: created.id, recordHashSha256 },
      ip: meta.ip,
    })

    return created
  }

  /**
   * `signature_event` has no Postgres RLS (same reasoning as `audit_entry`
   * — see the schema comment), so tenant scoping is enforced here in
   * application code, exactly like `AuditService.history()`.
   */
  async listForRecord(
    actor: AuthenticatedUser,
    recordType: string,
    recordId: string,
  ): Promise<SignatureEvent[]> {
    if (!actor.companyId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Reading signatures requires a tenant-scoped actor',
      })
    }

    return this.prisma.signatureEvent.findMany({
      where: { recordType, recordId, companyId: actor.companyId },
      orderBy: { signedAt: 'desc' },
    })
  }

  async verify(id: string): Promise<{ intact: boolean; signedAt: Date; signerId: string }> {
    const event = await this.prisma.signatureEvent.findUnique({ where: { id } })
    if (!event) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Signature not found' })
    }

    const recomputed = hashCanonicalPayload(event.canonicalPayload as Record<string, unknown>)
    return {
      intact: recomputed === event.recordHashSha256,
      signedAt: event.signedAt,
      signerId: event.signerId,
    }
  }
}
