import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

/**
 * QualCloud (Phase 13) Stage 0 — Foundation Layer, exercised end-to-end
 * against the real running app: the entity/hierarchy model (0.1 —
 * Supplier/Equipment/Sop/Specification), the ALCOA+ data-integrity core
 * (0.2 — RetentionPolicy), the unified quality-event/CAPA core (0.3 —
 * the `Capa.sourceRecordType`/`sourceRecordId` generalization, and
 * `RiskAssessment`), and RLS tenant isolation (0.4). Mirrors
 * `regcloud-stage0.e2e-spec.ts`'s own fixture shape exactly.
 */
describe('QualCloud Stage 0 — Foundation (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let otherCompanyId: string
  let manager: TestActor
  let viewer: TestActor
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

  async function seedRole(key: string, permissionKeys: string[]): Promise<void> {
    const roleId = randomUUID()
    await testPrisma.role.create({
      data: { id: roleId, key, name: key, description: 'test fixture', isPlatform: false },
    })
    for (const permKey of permissionKeys) {
      const permission = await testPrisma.permission.upsert({
        where: { key: permKey },
        create: { id: randomUUID(), key: permKey, description: 'test fixture' },
        update: {},
      })
      await testPrisma.rolePermission.create({
        data: { roleId, permissionId: permission.id },
      })
    }
  }

  beforeEach(async () => {
    const countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })

    companyId = randomUUID()
    await testPrisma.company.create({
      data: {
        id: companyId,
        name: 'QualCloud Test Co',
        companyType: 'manufacturer',
        homeCountryId: countryId,
        status: 'active',
      },
    })
    otherCompanyId = randomUUID()
    await testPrisma.company.create({
      data: {
        id: otherCompanyId,
        name: 'Other Tenant Co',
        companyType: 'manufacturer',
        homeCountryId: countryId,
        status: 'active',
      },
    })

    await seedRole('QUALITY_MANAGER_TEST', [
      'quality.view_all',
      'quality.manage_suppliers',
      'quality.manage_equipment',
      'quality.manage_documents',
      'quality.manage_capa',
    ])
    await seedRole('QUALITY_VIEWER_TEST', ['quality.view_all'])

    manager = await createAuthenticatedActor(app, testPrisma, {
      companyId,
      roleKeys: ['QUALITY_MANAGER_TEST'],
    })
    viewer = await createAuthenticatedActor(app, testPrisma, {
      companyId,
      roleKeys: ['QUALITY_VIEWER_TEST'],
    })
    outsider = await createAuthenticatedActor(app, testPrisma, {
      companyId: otherCompanyId,
      roleKeys: ['QUALITY_MANAGER_TEST'],
    })

    // QualCloud Stage 1 — `SopService.create()` now instantiates a real
    // `quality_controlled_document` workflow instance alongside the row
    // (this Stage 0 spec predates that and never exercises the
    // lifecycle itself), so a minimal definition/initial-state fixture
    // is required here purely so `POST /quality/sops` can resolve one —
    // same precedent as Stage 16's PSMF-gate fixture fix.
    const sopDefinitionId = randomUUID()
    await testPrisma.workflowDefinition.create({
      data: {
        id: sopDefinitionId,
        recordType: 'quality_controlled_document',
        reportTypeId: null,
        countryId: null,
        version: 1,
        status: 'active',
      },
    })
    await testPrisma.workflowState.create({
      data: {
        id: randomUUID(),
        definitionId: sopDefinitionId,
        stateKey: 'draft',
        name: 'draft',
        isInitial: true,
        isTerminal: false,
      },
    })
  })

  describe('Suppliers (0.1)', () => {
    it('creates, lists, updates, and deactivates a supplier — never deletes it', async () => {
      const createRes = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/suppliers'),
        manager,
      )
        .send({ name: 'Acme API Supplies', supplierType: 'api_supplier', criticality: 'critical' })
        .expect(201)
      const supplierId = createRes.body.data.id
      expect(createRes.body.data.approvalStatus).toBe('pending')

      const listRes = await authed(
        request(httpServer(app)).get('/api/v1/quality/suppliers'),
        manager,
      ).expect(200)
      expect(listRes.body.data).toHaveLength(1)

      // `approvalStatus` is no longer a plain PATCH-able field as of
      // Stage 11 — see `UpdateSupplierDto`'s own doc comment — a bare
      // name update still works through this generic endpoint.
      const updateRes = await authedWrite(
        request(httpServer(app)).patch(`/api/v1/quality/suppliers/${supplierId}`),
        manager,
      )
        .send({ name: 'Acme API Supplies Ltd' })
        .expect(200)
      expect(updateRes.body.data.name).toBe('Acme API Supplies Ltd')

      const deactivateRes = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/suppliers/${supplierId}/deactivate`),
        manager,
      ).expect(201)
      expect(deactivateRes.body.data.isActive).toBe(false)

      // Deactivated, never deleted — the record must still be readable
      // (a 404 here would mean it was actually removed, not just
      // flagged inactive). `supplier` carries `FORCE ROW LEVEL SECURITY`,
      // so this is asserted through the real authenticated API rather
      // than a raw `testPrisma` read, which would need its own
      // `app.bypass_rls` session var to see the row at all.
      const getRes = await authed(
        request(httpServer(app)).get(`/api/v1/quality/suppliers/${supplierId}`),
        manager,
      ).expect(200)
      expect(getRes.body.data.isActive).toBe(false)
    })

    it('blocks a view-only actor from creating a supplier', async () => {
      await authedWrite(request(httpServer(app)).post('/api/v1/quality/suppliers'), viewer)
        .send({ name: 'Blocked Co', supplierType: 'other' })
        .expect(403)
    })

    it('RLS: a supplier created by one tenant is invisible to another tenant', async () => {
      const createRes = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/suppliers'),
        manager,
      )
        .send({ name: 'Tenant A Supplier', supplierType: 'other' })
        .expect(201)
      const supplierId = createRes.body.data.id

      await authed(
        request(httpServer(app)).get(`/api/v1/quality/suppliers/${supplierId}`),
        outsider,
      ).expect(404)

      const outsiderList = await authed(
        request(httpServer(app)).get('/api/v1/quality/suppliers'),
        outsider,
      ).expect(200)
      expect(outsiderList.body.data).toHaveLength(0)
    })
  })

  describe('Equipment (0.1)', () => {
    it('creates equipment and advances its qualification status', async () => {
      const createRes = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/equipment'),
        manager,
      )
        .send({ name: 'HPLC-1', equipmentType: 'analytical_instrument' })
        .expect(201)
      expect(createRes.body.data.qualificationStatus).toBe('not_qualified')

      const updateRes = await authedWrite(
        request(httpServer(app)).patch(`/api/v1/quality/equipment/${createRes.body.data.id}`),
        manager,
      )
        .send({ qualificationStatus: 'qualified' })
        .expect(200)
      expect(updateRes.body.data.qualificationStatus).toBe('qualified')
    })
  })

  describe('Controlled documents / Sop (0.1, 0.2)', () => {
    it('creates a draft controlled document and edits it while still draft', async () => {
      const createRes = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/sops'),
        manager,
      )
        .send({ title: 'Deviation Handling', documentType: 'sop' })
        .expect(201)
      expect(createRes.body.data.status).toBe('draft')
      expect(createRes.body.data.currentVersion).toBe(1)

      const updateRes = await authedWrite(
        request(httpServer(app)).patch(`/api/v1/quality/sops/${createRes.body.data.id}`),
        manager,
      )
        .send({ title: 'Deviation Handling — Revised Title' })
        .expect(200)
      expect(updateRes.body.data.title).toBe('Deviation Handling — Revised Title')
    })

    it('generates a sequential controlled-document number (Pass A); a manual number is accepted only when it is a valid identifier (Pass C)', async () => {
      const first = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/sops'),
        manager,
      )
        .send({ title: 'First', documentType: 'sop' })
        .expect(201)
      const second = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/sops'),
        manager,
      )
        .send({ title: 'Second', documentType: 'sop' })
        .expect(201)
      expect(first.body.data.documentNumber).toMatch(/-SOP-\d{4}-0001$/)
      expect(second.body.data.documentNumber).toMatch(/-SOP-\d{4}-0002$/)
      // Phase 2 Pass C: manual entry is allowed, but digits-only is refused.
      await authedWrite(request(httpServer(app)).post('/api/v1/quality/sops'), manager)
        .send({ documentNumber: '0001', title: 'Digits only', documentType: 'sop' })
        .expect(400)
      const manual = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/sops'),
        manager,
      )
        .send({ documentNumber: 'MANUAL-1', title: 'Typed by hand', documentType: 'sop' })
        .expect(201)
      expect(manual.body.data.documentNumber).toBe('MANUAL-1')
    })
  })

  describe('Specifications (0.1) — nested parameters', () => {
    it('creates a specification with structured parameters in one write and replaces them on update', async () => {
      // Phase 2 Pass C: a finished-product specification must link a catalogue product.
      const product = await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        return tx.product.create({
          data: {
            id: randomUUID(),
            companyId,
            brandName: 'Paracetamol',
            genericName: 'Paracetamol',
            productCategory: 'medicinal',
            dosageForm: 'tablet',
            strength: '500mg',
          },
        })
      })
      const createRes = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/specifications'),
        manager,
      )
        .send({
          specificationNumber: 'SPEC-001',
          title: 'Paracetamol 500mg Tablets',
          specificationType: 'finished_product',
          productId: product.id,
          parameters: [
            {
              parameterName: 'Assay',
              testMethod: 'HPLC',
              lowerLimit: '95',
              upperLimit: '105',
              unit: '%',
            },
            { parameterName: 'Appearance', lowerLimit: 'White to off-white tablet' },
          ],
        })
        .expect(201)
      expect(createRes.body.data.parameters).toHaveLength(2)

      const updateRes = await authedWrite(
        request(httpServer(app)).patch(`/api/v1/quality/specifications/${createRes.body.data.id}`),
        manager,
      )
        .send({ parameters: [{ parameterName: 'Dissolution' }] })
        .expect(200)
      expect(updateRes.body.data.parameters).toHaveLength(1)
      expect(updateRes.body.data.parameters[0].parameterName).toBe('Dissolution')
    })
  })

  describe('Retention policies (0.2) — ALCOA+', () => {
    it('returns the coded domain defaults and lets a company override them', async () => {
      const defaultsRes = await authed(
        request(httpServer(app)).get('/api/v1/quality/retention-policies/defaults/deviation'),
        manager,
      ).expect(200)
      expect(defaultsRes.body.data.retentionYears).toBe(5)

      const upsertRes = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/retention-policies'),
        manager,
      )
        .send({ recordType: 'deviation', retentionYears: 8 })
        .expect(201)
      expect(upsertRes.body.data.retentionYears).toBe(8)

      // Re-upserting the same natural key updates in place, never duplicates.
      await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/retention-policies'),
        manager,
      )
        .send({ recordType: 'deviation', retentionYears: 10 })
        .expect(201)

      // Updated in place on the natural key, never duplicated — asserted
      // through the real authenticated list endpoint (`retention_policy`
      // carries `FORCE ROW LEVEL SECURITY`, same reasoning as the
      // supplier deactivation test above).
      const listRes = await authed(
        request(httpServer(app)).get('/api/v1/quality/retention-policies'),
        manager,
      ).expect(200)
      const rows = listRes.body.data as Array<{ recordType: string; retentionYears: number }>
      expect(rows.filter((r) => r.recordType === 'deviation')).toHaveLength(1)
      expect(rows.find((r) => r.recordType === 'deviation')!.retentionYears).toBe(10)
    })
  })

  describe('Risk assessments (0.3) — ICH Q9 live risk register', () => {
    it('computes and persists a real RPN score against an arbitrary quality-event source', async () => {
      const createRes = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/risk-assessments'),
        manager,
      )
        .send({
          sourceRecordType: 'deviation',
          sourceRecordId: randomUUID(),
          title: 'Temperature excursion risk',
          severity: 4,
          probability: 4,
          detectability: 3,
        })
        .expect(201)
      expect(createRes.body.data.score).toBe(48)
      expect(createRes.body.data.riskLevel).toBe('medium')
    })
  })

  describe('Severity definitions (0.3)', () => {
    it('exposes the real Critical/Major/Minor taxonomy', async () => {
      const res = await authed(
        request(httpServer(app)).get('/api/v1/quality/config/severity-definitions'),
        manager,
      ).expect(200)
      const definitions = res.body.data as Array<{ key: string }>
      expect(definitions.map((d) => d.key)).toEqual(['critical', 'major', 'minor'])
    })
  })

  describe('Capa generalization (0.3) — the polymorphic sourceRecordType/sourceRecordId pair', () => {
    it('opens a CAPA against a non-audit-finding source via the existing /capas endpoint', async () => {
      const sourceId = randomUUID()
      const res = await authedWrite(request(httpServer(app)).post('/api/v1/capas'), manager)
        .send({
          rootCause: 'Operators were not trained on the updated SOP',
          rootCauseCategory: 'human_error_training',
          ownerUserId: manager.userId,
          correctiveActionDueDate: '2026-12-01',
          correctiveAction: 'Retrain all line operators',
          sourceRecordType: 'deviation',
          sourceRecordId: sourceId,
        })
        .expect(201)
      expect(res.body.data.findingId).toBeNull()
      expect(res.body.data.sourceRecordType).toBe('deviation')
      expect(res.body.data.sourceRecordId).toBe(sourceId)
    })
  })
})
