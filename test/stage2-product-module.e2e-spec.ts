import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { ProductReviewReminderService } from '../src/modules/master-data/product-review-reminder.service'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

function authed(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader)
}

function authedWrite(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader).set('X-CSRF-Token', actor.csrfHeader)
}

async function seedRoleWithPermissions(roleKey: string, permissionKeys: string[]): Promise<void> {
  const role = await testPrisma.role.upsert({
    where: { key: roleKey },
    update: {},
    create: { id: randomUUID(), key: roleKey, name: roleKey, description: 'e2e fixture', isPlatform: false },
  })
  for (const key of permissionKeys) {
    const permission = await testPrisma.permission.upsert({ where: { key }, update: {}, create: { id: randomUUID(), key, description: 'e2e fixture' } })
    await testPrisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    })
  }
}

describe('VigiCloud Stage 2 — Product Module (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    companyId = randomUUID()
    await testPrisma.company.create({ data: { id: companyId, name: 'Stage2 Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })
  })

  describe('Product — PV-mandatory fields', () => {
    it('creates a product with the new INN/ATC/formulation/route/site/pack-sizes fields and returns them intact', async () => {
      await seedRoleWithPermissions('SYSTEM_ADMINISTRATOR', ['master_data.manage', 'master_data.view'])
      const actor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['SYSTEM_ADMINISTRATOR'] })

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/products'), actor)
        .send({
          brandName: 'Amoxiclav',
          genericName: 'Amoxicillin/Clavulanate',
          productCategory: 'medicinal',
          dosageForm: 'tablet',
          strength: '500mg/125mg',
          innName: 'Amoxicillin and Enzyme Inhibitor',
          atcCode: 'J01CR02',
          formulation: 'immediate release',
          routeOfAdministration: 'Oral',
          siteOfManufacture: 'Nairobi, Kenya',
          packSizes: ['10s blister', '30s bottle'],
        })
        .expect(201)

      expect(created.body.data).toMatchObject({
        innName: 'Amoxicillin and Enzyme Inhibitor',
        atcCode: 'J01CR02',
        formulation: 'immediate release',
        routeOfAdministration: 'Oral',
        siteOfManufacture: 'Nairobi, Kenya',
        packSizes: ['10s blister', '30s bottle'],
      })

      const found = await authed(request(httpServer(app)).get('/api/v1/products?q=J01CR02'), actor).expect(200)
      expect(found.body.data).toHaveLength(1)
      expect(found.body.data[0].id).toBe(created.body.data.id)
    })
  })

  describe('Bulk import — products', () => {
    it('previews and commits a product CSV, gated by master_data.manage (not users.invite)', async () => {
      await seedRoleWithPermissions('SYSTEM_ADMINISTRATOR', ['master_data.manage'])
      const actor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['SYSTEM_ADMINISTRATOR'] })

      const csvText = [
        'Brand Name,Generic Name,Category,Dosage Form,Strength,ATC Code',
        'Panadol,Paracetamol,Medicinal,Tablet,500mg,N02BE01',
        'Bad Row,Missing Category,,Tablet,500mg,',
      ].join('\n')

      const previewRes = await authedWrite(request(httpServer(app)).post('/api/v1/bulk-import/product/preview'), actor).send({ csvText }).expect(201)
      expect(previewRes.body.data.validRows).toHaveLength(1)
      expect(previewRes.body.data.invalidRows).toHaveLength(1)
      expect(previewRes.body.data.invalidRows[0].errors[0]).toContain('Category is required')

      const validRows = previewRes.body.data.validRows as { data: Record<string, string> }[]
      const commitRes = await authedWrite(request(httpServer(app)).post('/api/v1/bulk-import/product/commit'), actor)
        .send({ rows: validRows.map((r) => r.data) })
        .expect(201)
      expect(commitRes.body.data.committed).toBe(1)

      const products = await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        return tx.product.findMany({ where: { companyId, brandName: 'Panadol' } })
      })
      expect(products).toHaveLength(1)
      expect(products[0].atcCode).toBe('N02BE01')
    })

    it('403s an actor who only has users.invite, not master_data.manage — proving the per-importType permission gate is real', async () => {
      await seedRoleWithPermissions('INVITER_ONLY', ['users.invite'])
      const actor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['INVITER_ONLY'] })

      await authedWrite(request(httpServer(app)).post('/api/v1/bulk-import/product/preview'), actor)
        .send({ csvText: 'Brand Name,Generic Name,Category,Dosage Form,Strength\nX,Y,Medicinal,Tablet,10mg' })
        .expect(403)
    })

    it('404s the unknown-import-type path the same as before this change', async () => {
      await seedRoleWithPermissions('SYSTEM_ADMINISTRATOR', ['master_data.manage'])
      const actor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['SYSTEM_ADMINISTRATOR'] })
      await authedWrite(request(httpServer(app)).post('/api/v1/bulk-import/not_a_real_type/preview'), actor).send({ csvText: 'a,b\n1,2' }).expect(404)
    })
  })

  describe('Quarterly product-list-review reminder', () => {
    it('creates one open Task assigned to SYSTEM_ADMINISTRATOR for a company with no prior reminder, visible via the real Task Inbox endpoint', async () => {
      await seedRoleWithPermissions('SYSTEM_ADMINISTRATOR', [])
      const actor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['SYSTEM_ADMINISTRATOR'] })

      const reminderService = app.get(ProductReviewReminderService)
      const result = await reminderService.scanAndRemind()
      expect(result.remindersCreated).toBeGreaterThanOrEqual(1)

      const tasks = await authed(request(httpServer(app)).get('/api/v1/tasks?scope=role'), actor).expect(200)
      const reminder = (tasks.body.data as { recordType: string; title: string }[]).find((t) => t.recordType === 'product_list_review')
      expect(reminder).toBeDefined()
      expect(reminder!.title).toContain('Quarterly product list review')
    })

    it('does not create a second reminder for the same company on a second scan run immediately after', async () => {
      const reminderService = app.get(ProductReviewReminderService)
      const first = await reminderService.scanAndRemind()
      const second = await reminderService.scanAndRemind()

      expect(first.remindersCreated).toBeGreaterThanOrEqual(1)
      expect(second.remindersCreated).toBe(0)
    })
  })

  describe('SuspectProduct.productId — case intake linking to the product catalog', () => {
    it('links a suspect product row to a real catalog Product end-to-end through case creation', async () => {
      await seedRoleWithPermissions('SYSTEM_ADMINISTRATOR', ['master_data.manage', 'pv.capture_case'])
      const actor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['SYSTEM_ADMINISTRATOR'] })

      const product = await authedWrite(request(httpServer(app)).post('/api/v1/products'), actor)
        .send({ brandName: 'Amoxil', genericName: 'Amoxicillin', productCategory: 'medicinal', dosageForm: 'capsule', strength: '250mg' })
        .expect(201)

      const reportTypeId = randomUUID()
      await testPrisma.reportType.create({ data: { id: reportTypeId, typeKey: `adr_e2e_${randomUUID()}`, name: 'Suspected ADR' } })
      const superintendentRoleId = randomUUID()
      await testPrisma.role.create({ data: { id: superintendentRoleId, key: 'SUPERINTENDENT_PHARMACIST', name: 'Superintendent Pharmacist', description: 'e2e fixture', isPlatform: false } })
      const definitionId = randomUUID()
      await testPrisma.workflowDefinition.create({ data: { id: definitionId, recordType: 'pv_case', reportTypeId: null, countryId: null, version: 1, status: 'active' } })
      const intakeId = randomUUID()
      const triageId = randomUUID()
      await testPrisma.workflowState.createMany({
        data: [
          { id: intakeId, definitionId, stateKey: 'intake', name: 'Intake', isInitial: true, isTerminal: false },
          { id: triageId, definitionId, stateKey: 'triage', name: 'Triage', isInitial: false, isTerminal: true },
        ],
      })
      await testPrisma.workflowTransition.create({
        data: { id: randomUUID(), definitionId, fromStateId: intakeId, toStateId: triageId, requiredRoleId: superintendentRoleId, requiresSignature: false },
      })

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor)
        .send({
          reportTypeId,
          countryOfOccurrenceId: countryId,
          countryOfReportId: countryId,
          awarenessDate: '2026-08-01',
          receivedDate: '2026-08-02',
          reporter: { reporterType: 'healthcare_professional' },
          patient: { sex: 'unknown' },
          suspectProducts: [{ drugCharacterization: 'suspect', medicinalProduct: 'Amoxil', productId: product.body.data.id }],
          adverseEvents: [{ reportedTerm: 'Rash', narrative: 'A rash appeared' }],
        })
        .expect(201)

      expect(created.body.data.suspectProducts[0].productId).toBe(product.body.data.id)
    })
  })
})
