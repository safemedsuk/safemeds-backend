import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { newId } from '../src/common/id'
import { DeviationInvestigationReminderService } from '../src/modules/quality/deviation-investigation-reminder.service'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

/**
 * QualCloud Phase 1 Pass A2 — CAPA allocation (owner, separate corrective and
 * preventive due dates, root cause and category, regulatory approver),
 * visibility, evidence-gated close, deviation-linked CAPAs, the
 * investigation-due reminder, and the audit trail for each of them, walked
 * against the real running app and real Postgres.
 */
describe('QualCloud Pass A2 — CAPA allocation, visibility, evidence and reminders (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let manager: TestActor
  let owner: TestActor
  let approver: TestActor
  let outsider: TestActor

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  function authed(req: request.Test, actor: TestActor): request.Test {
    return req.set('Cookie', actor.cookieHeader)
  }

  function authedWrite(req: request.Test, actor: TestActor): request.Test {
    return req.set('Cookie', actor.cookieHeader).set('X-CSRF-Token', actor.csrfHeader)
  }

  /** Reads/writes that must bypass tenant RLS for fixture setup and audit assertions only. */
  function withBypass<T>(fn: (tx: typeof testPrisma) => Promise<T>): Promise<T> {
    return testPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
      return fn(tx as unknown as typeof testPrisma)
    })
  }

  async function seedRole(key: string, permissionKeys: string[]): Promise<void> {
    const roleId = randomUUID()
    await testPrisma.role.create({
      data: { id: roleId, key, name: key, description: 'pass a2 fixture', isPlatform: false },
    })
    for (const permKey of permissionKeys) {
      const permission = await testPrisma.permission.upsert({
        where: { key: permKey },
        create: { id: randomUUID(), key: permKey, description: 'pass a2 fixture' },
        update: {},
      })
      await testPrisma.rolePermission.create({ data: { roleId, permissionId: permission.id } })
    }
  }

  beforeEach(async () => {
    const countryId = newId()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    companyId = newId()
    await testPrisma.company.create({
      data: {
        id: companyId,
        name: 'QualCloud Pass A2 Test Co',
        companyType: 'manufacturer',
        homeCountryId: countryId,
        status: 'active',
      },
    })

    await seedRole('QUALITY_MANAGER', [
      'quality.view_all',
      'quality.manage_capa',
      'quality.close_capa',
      'quality.log_deviation',
    ])
    await seedRole('QUALITY_ASSOCIATE', ['quality.manage_capa', 'quality.log_deviation'])
    await seedRole('REGULATORY_AFFAIRS_OFFICER', ['regulatory.manage_registrations'])
    await seedRole('EXECUTIVE_READONLY', [])

    manager = await createAuthenticatedActor(app, testPrisma, {
      companyId,
      roleKeys: ['QUALITY_MANAGER'],
    })
    owner = await createAuthenticatedActor(app, testPrisma, {
      companyId,
      roleKeys: ['QUALITY_ASSOCIATE'],
    })
    approver = await createAuthenticatedActor(app, testPrisma, {
      companyId,
      roleKeys: ['REGULATORY_AFFAIRS_OFFICER'],
    })
    outsider = await createAuthenticatedActor(app, testPrisma, {
      companyId,
      roleKeys: ['EXECUTIVE_READONLY'],
    })
  })

  /** A complete, valid allocation body — each test varies one field to exercise one rule. */
  function allocation(
    ownerUserId: string,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      rootCause: 'Cold-chain door left open during loading',
      rootCauseCategory: 'human_error_training',
      correctiveAction: 'Retrain drivers on the cold-chain SOP',
      ownerUserId,
      correctiveActionDueDate: '2026-12-01',
      ...extra,
    }
  }

  async function openCapa(extra: Record<string, unknown> = {}): Promise<string> {
    const res = await authedWrite(request(httpServer(app)).post('/api/v1/capas'), manager)
      .send(allocation(owner.userId, extra))
      .expect(201)
    return res.body.data.id as string
  }

  async function auditActions(recordId: string): Promise<string[]> {
    const rows = await withBypass((tx) =>
      tx.auditEntry.findMany({ where: { companyId, recordId }, select: { action: true } }),
    )
    return rows.map((r) => r.action)
  }

  describe('root cause categories and allocation rules', () => {
    it('exposes the curated category list, including "Other (type it)"', async () => {
      const res = await authed(
        request(httpServer(app)).get('/api/v1/capas/root-cause-categories'),
        owner,
      ).expect(200)
      const keys = (res.body.data as { key: string }[]).map((c) => c.key)
      expect(keys).toContain('human_error_training')
      expect(keys).toContain('equipment_failure')
      expect(keys).toContain('other')
    })

    it('refuses a CAPA with no owner, and an owner who does not hold quality.manage_capa', async () => {
      const noOwner = { ...allocation(owner.userId) }
      delete (noOwner as Record<string, unknown>).ownerUserId
      await authedWrite(request(httpServer(app)).post('/api/v1/capas'), manager)
        .send(noOwner)
        .expect(400)

      const res = await authedWrite(request(httpServer(app)).post('/api/v1/capas'), manager)
        .send(allocation(outsider.userId))
        .expect(400)
      expect(res.body.error.code).toBe('OWNER_NOT_QUALIFIED')
    })

    it('requires a preventive due date whenever a preventive action is given, and derives the title from the root cause', async () => {
      const res = await authedWrite(request(httpServer(app)).post('/api/v1/capas'), manager)
        .send(allocation(owner.userId, { preventiveAction: 'Add a door-closed interlock' }))
        .expect(400)
      expect(res.body.error.code).toBe('PREVENTIVE_DUE_DATE_REQUIRED')

      const ok = await authedWrite(request(httpServer(app)).post('/api/v1/capas'), manager)
        .send(
          allocation(owner.userId, {
            preventiveAction: 'Add a door-closed interlock',
            preventiveActionDueDate: '2027-01-15',
          }),
        )
        .expect(201)
      expect(ok.body.data.title).toBe('Cold-chain door left open during loading')
      expect(ok.body.data.preventiveActionDueDate).toMatch(/^2027-01-15/)
      expect(ok.body.data.correctiveActionDueDate).toMatch(/^2026-12-01/)
    })

    it('stores typed free text when "other" is chosen, and refuses "other" without it', async () => {
      await authedWrite(request(httpServer(app)).post('/api/v1/capas'), manager)
        .send(allocation(owner.userId, { rootCauseCategory: 'other' }))
        .expect(400)
      const ok = await authedWrite(request(httpServer(app)).post('/api/v1/capas'), manager)
        .send(
          allocation(owner.userId, {
            rootCauseCategory: 'other',
            rootCauseOther: 'Vendor portal outage',
          }),
        )
        .expect(201)
      expect(ok.body.data.rootCauseCategory).toBe('Vendor portal outage')
    })
  })

  describe('regulatory approver', () => {
    it('refuses an approver who lacks regulatory.manage_registrations, and designates one who holds it (audited)', async () => {
      const bad = await authedWrite(request(httpServer(app)).post('/api/v1/capas'), manager)
        .send(
          allocation(owner.userId, {
            requiresRegulatoryApproval: true,
            regulatoryApproverUserId: owner.userId,
          }),
        )
        .expect(400)
      expect(bad.body.error.code).toBe('REGULATORY_APPROVER_NOT_QUALIFIED')

      const capaId = await openCapa({
        requiresRegulatoryApproval: true,
        regulatoryApproverUserId: approver.userId,
      })
      expect(await auditActions(capaId)).toContain('capa_regulatory_approver_assigned')
    })

    it('lets the creator reassign the regulatory approver, audited as a reassignment', async () => {
      const capaId = await openCapa({
        requiresRegulatoryApproval: true,
        regulatoryApproverUserId: approver.userId,
      })
      const second = await createAuthenticatedActor(app, testPrisma, {
        companyId,
        roleKeys: ['REGULATORY_AFFAIRS_OFFICER'],
      })
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/capas/${capaId}/regulatory-approver`),
        manager,
      )
        .send({ regulatoryApproverUserId: second.userId })
        .expect(201)
      expect(await auditActions(capaId)).toContain('capa_regulatory_approver_reassigned')
    })

    it("lists only the approver's own CAPAs, and hides the rest (404) from a non-manager", async () => {
      const mine = await openCapa({
        requiresRegulatoryApproval: true,
        regulatoryApproverUserId: approver.userId,
      })
      const theirs = await openCapa({ rootCause: 'A different CAPA nobody routed to the approver' })

      const list = await authed(request(httpServer(app)).get('/api/v1/capas'), approver).expect(200)
      const ids = (list.body.data as { id: string }[]).map((c) => c.id)
      expect(ids).toEqual([mine])

      await authed(request(httpServer(app)).get(`/api/v1/capas/${mine}`), approver).expect(200)
      await authed(request(httpServer(app)).get(`/api/v1/capas/${theirs}`), approver).expect(404)
    })

    it("keeps managers' company-wide access unchanged", async () => {
      const capaId = await openCapa({
        requiresRegulatoryApproval: true,
        regulatoryApproverUserId: approver.userId,
      })
      await authed(request(httpServer(app)).get(`/api/v1/capas/${capaId}`), manager).expect(200)
      const list = await authed(request(httpServer(app)).get('/api/v1/capas'), manager).expect(200)
      expect((list.body.data as unknown[]).length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('ownership, due dates and evidence', () => {
    it('audits an owner reassignment and a due-date change', async () => {
      const capaId = await openCapa()
      const next = await createAuthenticatedActor(app, testPrisma, {
        companyId,
        roleKeys: ['QUALITY_ASSOCIATE'],
      })
      await authedWrite(request(httpServer(app)).patch(`/api/v1/capas/${capaId}`), manager)
        .send({ ownerUserId: next.userId, correctiveActionDueDate: '2027-02-01' })
        .expect(200)
      const actions = await auditActions(capaId)
      expect(actions).toContain('capa_owner_reassigned')
      expect(actions).toContain('capa_due_dates_changed')
    })

    it('refuses to close with no evidence, then closes once a document is attached, and audits the evidence count', async () => {
      const capaId = await openCapa()
      await authedWrite(request(httpServer(app)).post(`/api/v1/capas/${capaId}/approve`), manager)
        .send({})
        .expect(201)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/capas/${capaId}/implement`),
        manager,
      ).expect(201)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/capas/${capaId}/effectiveness-check`),
        manager,
      )
        .send({ result: 'effective' })
        .expect(201)

      const blocked = await authedWrite(
        request(httpServer(app)).post(`/api/v1/capas/${capaId}/close`),
        manager,
      ).expect(409)
      expect(blocked.body.error.code).toBe('EVIDENCE_REQUIRED')

      // The real upload goes to R2, which this Jest harness cannot reach (documented TLS
      // gotcha) — attach a real Document row directly, exactly what uploadEvidence() writes.
      await withBypass((tx) =>
        tx.document.create({
          data: {
            id: randomUUID(),
            companyId,
            recordType: 'capa',
            recordId: capaId,
            title: 'evidence',
          },
        }),
      )
      const closed = await authedWrite(
        request(httpServer(app)).post(`/api/v1/capas/${capaId}/close`),
        manager,
      ).expect(201)
      expect(closed.body.data.status).toBe('closed')

      const closedAudit = await withBypass((tx) =>
        tx.auditEntry.findFirst({ where: { companyId, recordId: capaId, action: 'capa_closed' } }),
      )
      expect(
        (closedAudit?.newValue as { evidenceDocumentCount?: number } | null)?.evidenceDocumentCount,
      ).toBe(1)
    })
  })

  describe('deviation-linked CAPAs', () => {
    it('lists every CAPA linked to a deviation, with its owner and status, on the deviation detail', async () => {
      const deviationId = newId()
      await withBypass((tx) =>
        tx.deviation.create({
          data: {
            id: deviationId,
            companyId,
            deviationNumber: 'DEV-2026-00001',
            title: 'Seal failure on line 2',
            sourceType: 'self_reported',
            detectedAt: new Date('2026-09-01T00:00:00Z'),
            status: 'capa_pending',
            raisedBy: manager.userId,
            createdBy: manager.userId,
          },
        }),
      )
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/deviations/${deviationId}/capa`),
        manager,
      )
        .send(allocation(owner.userId, { rootCause: 'Seal bar temperature drifted high' }))
        .expect(201)

      const detail = await authed(
        request(httpServer(app)).get(`/api/v1/quality/deviations/${deviationId}`),
        manager,
      ).expect(200)
      const capas = detail.body.data.capas as {
        rootCause: string
        status: string
        owner: { fullName: string } | null
      }[]
      expect(capas).toHaveLength(1)
      expect(capas[0].rootCause).toBe('Seal bar temperature drifted high')
      expect(capas[0].status).toBe('open')
      expect(capas[0].owner).not.toBeNull()
      expect(capas[0].owner?.fullName).toEqual(expect.any(String))
    })
  })

  describe('investigation-due reminder', () => {
    it('sends the approaching reminder once, records the stage, and audits it', async () => {
      const deviationId = newId()
      const dueInTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
      await withBypass((tx) =>
        tx.deviation.create({
          data: {
            id: deviationId,
            companyId,
            deviationNumber: 'DEV-2026-00002',
            title: 'Label mix-up',
            sourceType: 'self_reported',
            detectedAt: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000),
            status: 'investigating',
            investigationDueAt: dueInTwoDays,
            raisedBy: owner.userId,
            createdBy: owner.userId,
          },
        }),
      )

      const reminders = app.get(DeviationInvestigationReminderService)
      const first = await reminders.scan()
      expect(first.remindersSent).toBeGreaterThanOrEqual(1)

      const stored = await withBypass((tx) =>
        tx.deviation.findUniqueOrThrow({ where: { id: deviationId } }),
      )
      expect(stored.investigationReminderStage).toBe('approaching')

      const notified = await withBypass((tx) =>
        tx.notification.count({
          where: { companyId, recordId: deviationId, userId: owner.userId },
        }),
      )
      expect(notified).toBe(1)
      expect(await auditActions(deviationId)).toContain('deviation_investigation_reminder_sent')

      // Idempotent: the same stage is never sent again on a later daily run.
      await reminders.scan()
      const notifiedAgain = await withBypass((tx) =>
        tx.notification.count({
          where: { companyId, recordId: deviationId, userId: owner.userId },
        }),
      )
      expect(notifiedAgain).toBe(1)
    })
  })
})
