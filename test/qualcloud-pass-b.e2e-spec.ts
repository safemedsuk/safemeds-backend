import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { newId } from '../src/common/id'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

/**
 * QualCloud Phase 1 Pass B — the flows that do NOT touch R2, walked against the
 * real running app and real Postgres:
 *
 * - Waste disposal case: create (step 1), application (step 2), strict step
 *   order, closure gated on steps 2–6 and on the manager-only permission.
 * - Equipment: a passing DQ/IQ/OQ/PQ event needs a validation report that is
 *   attached to THIS equipment; maintenance log writes and reads back.
 * - Suppliers: approval needs the GMP certificate on file; a monitor review
 *   needs an uploaded checklist that belongs to this supplier.
 * - Management review: attendees are structured rows, added and withdrawn,
 *   every change audited.
 *
 * Document uploads (evidence, photos, GMP certificate, validation report,
 * checklist) go to R2, which the Jest harness cannot reach (the documented TLS
 * gotcha). Those paths are covered by mocked-I/O unit specs instead; this suite
 * only asserts that the gates refuse without an upload.
 */
describe('QualCloud Pass B — waste disposal, equipment, suppliers, management review (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let manager: TestActor
  let associate: TestActor

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

  function withBypass<T>(fn: (tx: typeof testPrisma) => Promise<T>): Promise<T> {
    return testPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
      return fn(tx as unknown as typeof testPrisma)
    })
  }

  async function seedRole(key: string, permissionKeys: string[]): Promise<void> {
    const roleId = randomUUID()
    await testPrisma.role.create({
      data: { id: roleId, key, name: key, description: 'pass b fixture', isPlatform: false },
    })
    for (const permKey of permissionKeys) {
      const permission = await testPrisma.permission.upsert({
        where: { key: permKey },
        create: { id: randomUUID(), key: permKey, description: 'pass b fixture' },
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
        name: 'QualCloud Pass B Test Co',
        companyType: 'manufacturer',
        homeCountryId: countryId,
        status: 'active',
      },
    })

    await seedRole('QUALITY_MANAGER', [
      'quality.view_all',
      'quality.view_metrics',
      'quality.manage_waste_disposal',
      'quality.close_waste_disposal',
      'quality.manage_equipment',
      'quality.manage_suppliers',
      'quality.approve_suppliers',
      'quality.manage_management_review',
    ])
    await seedRole('QUALITY_ASSOCIATE', [
      'quality.view_all',
      'quality.manage_waste_disposal',
      'quality.manage_equipment',
      'quality.manage_suppliers',
    ])

    manager = await createAuthenticatedActor(app, testPrisma, {
      companyId,
      roleKeys: ['QUALITY_MANAGER'],
    })
    associate = await createAuthenticatedActor(app, testPrisma, {
      companyId,
      roleKeys: ['QUALITY_ASSOCIATE'],
    })
  })

  // ------------------------------------------------------------------ waste disposal

  describe('waste disposal case (7 steps)', () => {
    const weighed = {
      wasteDescription: 'Expired amoxicillin 500mg capsules',
      quantity: '120',
      unit: 'capsules',
      weighedAt: '2026-09-01T09:00:00.000Z',
    }

    async function openCase(): Promise<string> {
      const res = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/waste-disposal-cases'),
        associate,
      )
        .send(weighed)
        .expect(201)
      return res.body.data.id as string
    }

    it('creates a case with a readable case number and starts at step 2', async () => {
      const res = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/waste-disposal-cases'),
        associate,
      )
        .send(weighed)
        .expect(201)
      expect(res.body.data.caseNumber).toMatch(/-WDC-\d{4}-\d{4}$/)
      expect(res.body.data.currentStep).toBe(2)
      expect(res.body.data.status).toBe('open')
    })

    it('lists cases the way the Waste Disposal screen requests them, and reads one back', async () => {
      const id = await openCase()
      const list = await authed(
        request(httpServer(app))
          .get('/api/v1/quality/waste-disposal-cases')
          .query({ page: 1, limit: 100 }),
        associate,
      ).expect(200)
      expect(list.body.meta).toEqual(expect.objectContaining({ page: 1, limit: 100 }))
      const listed = list.body.data as Array<{ id: string }>
      expect(listed.map((c) => c.id)).toContain(id)

      const open = await authed(
        request(httpServer(app))
          .get('/api/v1/quality/waste-disposal-cases')
          .query({ page: 1, limit: 100, status: 'open' }),
        associate,
      ).expect(200)
      const openRows = open.body.data as Array<{ status: string }>
      expect(openRows.every((c) => c.status === 'open')).toBe(true)

      const one = await authed(
        request(httpServer(app)).get(`/api/v1/quality/waste-disposal-cases/${id}`),
        associate,
      ).expect(200)
      expect(one.body.data.id).toBe(id)
      expect(one.body.data.steps).toBeDefined()
    })

    it('refuses destruction details before the PPB application and handover are done (step order)', async () => {
      const id = await openCase()
      const res = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/waste-disposal-cases/${id}/destruction`),
        associate,
      )
        .send({ destructionDate: '2026-10-03', destructionLocation: 'Dandora site' })
        .expect(409)
      expect(res.body.error.code).toBe('STEP_OUT_OF_ORDER')
    })

    it('records the PPB application (step 2) and moves the case to step 3', async () => {
      const id = await openCase()
      const res = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/waste-disposal-cases/${id}/application`),
        associate,
      )
        .send({
          applicationReference: 'PPB/APP/2026/0042',
          invoiceReference: 'INV-7781',
          feeAmountKes: 2500,
          applicationSubmittedAt: '2026-09-05',
        })
        .expect(201)
      expect(res.body.data.currentStep).toBe(3)
      expect(res.body.data.step2Application.applicationReference).toBe('PPB/APP/2026/0042')
      expect(res.body.data.warnings).toEqual([])
    })

    it('blocks closure with a plain-language list of what is missing', async () => {
      const id = await openCase()
      const res = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/waste-disposal-cases/${id}/close`),
        manager,
      ).expect(409)
      expect(res.body.error.code).toBe('CLOSURE_BLOCKED')
      expect(res.body.error.message).toMatch(/Step 2:/)
      expect(res.body.error.message).toMatch(/Step 6:/)
    })

    it('only a manager can close (quality.close_waste_disposal), even though an associate can run the steps', async () => {
      const id = await openCase()
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/waste-disposal-cases/${id}/close`),
        associate,
      ).expect(403)
    })

    it('audits every step it takes', async () => {
      const id = await openCase()
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/waste-disposal-cases/${id}/application`),
        associate,
      )
        .send({
          applicationReference: 'A1',
          invoiceReference: 'I1',
          feeAmountKes: 2500,
          applicationSubmittedAt: '2026-09-05',
        })
        .expect(201)
      const actions = await withBypass((tx) =>
        tx.auditEntry.findMany({ where: { companyId, recordId: id }, select: { action: true } }),
      )
      const names = actions.map((a) => a.action)
      expect(names).toContain('waste_disposal_case_created')
      expect(names).toContain('waste_disposal_application_recorded')
    })

    it('refuses an invoice upload before step 2 is done', async () => {
      const id = await openCase()
      const res = await authed(
        request(httpServer(app)).post(
          `/api/v1/quality/waste-disposal-cases/${id}/evidence/invoice`,
        ),
        associate,
      )
        .set('X-CSRF-Token', associate.csrfHeader)
        .attach('file', Buffer.from('%PDF-1.4 fake'), {
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
        })
        .expect(409)
      expect(res.body.error.code).toBe('STEP_OUT_OF_ORDER')
    })
  })

  // ------------------------------------------------------------------ equipment

  describe('equipment qualification and maintenance', () => {
    async function createEquipment(): Promise<string> {
      const res = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/equipment'),
        manager,
      )
        .send({ name: 'Autoclave A', equipmentType: 'sterilizer' })
        .expect(201)
      return res.body.data.id as string
    }

    it('refuses a passing DQ event with no validation report', async () => {
      const id = await createEquipment()
      const res = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/equipment/${id}/qualification-events`),
        manager,
      )
        .send({ stage: 'dq', result: 'pass' })
        .expect(400)
      expect(res.body.error.code).toBe('VALIDATION_REPORT_REQUIRED')
    })

    it('refuses a passing event that cites a document not attached to this equipment', async () => {
      const id = await createEquipment()
      const res = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/equipment/${id}/qualification-events`),
        manager,
      )
        .send({ stage: 'dq', result: 'pass', reportDocumentId: randomUUID() })
        .expect(400)
      expect(res.body.error.code).toBe('VALIDATION_REPORT_NOT_FOUND')
    })

    it('records a failed step without a report, and it does not advance the status', async () => {
      const id = await createEquipment()
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/equipment/${id}/qualification-events`),
        manager,
      )
        .send({ stage: 'iq', result: 'fail', notes: 'Door seal leaks' })
        .expect(201)
      const list = await authed(
        request(httpServer(app)).get('/api/v1/quality/equipment'),
        manager,
      ).expect(200)
      const row = (list.body.data as Array<{ id: string; qualificationStatus: string }>).find(
        (r) => r.id === id,
      )
      expect(row?.qualificationStatus).toBe('not_qualified')
    })

    it('logs a maintenance entry that reads back, and the register shows the latest entry and a derived status', async () => {
      const id = await createEquipment()
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/equipment/${id}/maintenance-records`),
        manager,
      )
        .send({
          maintenanceDate: '2026-09-20',
          description: 'Replaced door gasket',
          nextDueAt: '2026-12-20T00:00:00.000Z',
        })
        .expect(201)
      const history = await authed(
        request(httpServer(app)).get(`/api/v1/quality/equipment/${id}/maintenance-records`),
        manager,
      ).expect(200)
      expect(history.body.data).toHaveLength(1)
      expect(history.body.data[0].description).toBe('Replaced door gasket')

      const list = await authed(
        request(httpServer(app)).get('/api/v1/quality/equipment'),
        manager,
      ).expect(200)
      const row = (list.body.data as Array<Record<string, unknown>>).find((r) => r.id === id)
      expect(row?.maintenanceStatus).toBe('current')
      expect((row?.latestMaintenance as { description: string }).description).toBe(
        'Replaced door gasket',
      )
    })
  })

  // ------------------------------------------------------------------ suppliers

  describe('supplier approval and biennial review', () => {
    async function createSupplier(): Promise<string> {
      const res = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/suppliers'),
        manager,
      )
        .send({ name: 'Acme API Co', supplierType: 'api_supplier', criticality: 'critical' })
        .expect(201)
      return res.body.data.id as string
    }

    it('refuses approval until a GMP certificate is on file', async () => {
      const id = await createSupplier()
      const res = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/supplier-qualification/${id}/approve`),
        manager,
      )
        .send({ approvalStatus: 'approved' })
        .expect(409)
      expect(res.body.error.code).toBe('GMP_CERTIFICATE_REQUIRED')
    })

    it('refuses a biennial review whose checklist was never uploaded for this supplier', async () => {
      const id = await createSupplier()
      const res = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/supplier-qualification/${id}/monitor`),
        manager,
      )
        .send({ flag: 'On-time delivery 97%', checklistDocumentId: randomUUID() })
        .expect(400)
      expect(res.body.error.code).toBe('CHECKLIST_NOT_FOUND')
    })

    it('still allows suspending a supplier without a GMP certificate', async () => {
      const id = await createSupplier()
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/supplier-qualification/${id}/approve`),
        manager,
      )
        .send({ approvalStatus: 'suspended' })
        .expect(201)
    })
  })

  // ------------------------------------------------------------------ management review

  describe('management review attendees', () => {
    it('stores attendees as structured rows, adds and withdraws them, and audits each change', async () => {
      const created = await authedWrite(
        request(httpServer(app)).post('/api/v1/management-reviews'),
        manager,
      )
        .send({
          period: '2026-Q3',
          reviewDate: '2026-10-01',
          attendeeRows: [{ name: 'Asha Mwangi', roleOrOrganisation: 'Head of Quality' }],
        })
        .expect(201)
      const reviewId = created.body.data.id as string

      const added = await authedWrite(
        request(httpServer(app)).post(`/api/v1/management-reviews/${reviewId}/attendees`),
        manager,
      )
        .send({ name: 'Peter Otieno', roleOrOrganisation: 'QPPV' })
        .expect(201)
      const attendeeId = added.body.data.id as string

      let review = await authed(
        request(httpServer(app)).get(`/api/v1/management-reviews/${reviewId}`),
        manager,
      ).expect(200)
      expect((review.body.data.attendeeRows as { name: string }[]).map((a) => a.name)).toEqual([
        'Asha Mwangi',
        'Peter Otieno',
      ])

      await authedWrite(
        request(httpServer(app)).post(
          `/api/v1/management-reviews/${reviewId}/attendees/${attendeeId}/withdraw`,
        ),
        manager,
      ).expect(201)
      review = await authed(
        request(httpServer(app)).get(`/api/v1/management-reviews/${reviewId}`),
        manager,
      ).expect(200)
      expect((review.body.data.attendeeRows as { name: string }[]).map((a) => a.name)).toEqual([
        'Asha Mwangi',
      ])

      const actions = await withBypass((tx) =>
        tx.auditEntry.findMany({
          where: { companyId, recordId: reviewId },
          select: { action: true },
        }),
      )
      const names = actions.map((a) => a.action)
      expect(names).toContain('management_review_attendee_added')
      expect(names).toContain('management_review_attendee_withdrawn')
    })

    it('refuses to withdraw the same attendee twice', async () => {
      const created = await authedWrite(
        request(httpServer(app)).post('/api/v1/management-reviews'),
        manager,
      )
        .send({ period: '2026-Q3', reviewDate: '2026-10-02', attendeeRows: [{ name: 'Jane Doe' }] })
        .expect(201)
      const reviewId = created.body.data.id as string
      const review = await authed(
        request(httpServer(app)).get(`/api/v1/management-reviews/${reviewId}`),
        manager,
      ).expect(200)
      const attendeeId = review.body.data.attendeeRows[0].id as string
      await authedWrite(
        request(httpServer(app)).post(
          `/api/v1/management-reviews/${reviewId}/attendees/${attendeeId}/withdraw`,
        ),
        manager,
      ).expect(201)
      const again = await authedWrite(
        request(httpServer(app)).post(
          `/api/v1/management-reviews/${reviewId}/attendees/${attendeeId}/withdraw`,
        ),
        manager,
      ).expect(409)
      expect(again.body.error.code).toBe('ALREADY_WITHDRAWN')
    })
  })
})
