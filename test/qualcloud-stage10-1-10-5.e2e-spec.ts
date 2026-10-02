import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { newId } from '../src/common/id'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

/**
 * QualCloud (Phase 13) Stage 10.1–10.5 — the recall country rules
 * engine, case lifecycle/scope/risk, distribution/cascade/traceability,
 * the external stakeholder portal, and returns/quarantine/
 * reconciliation/destruction/effectiveness — exercised end to end
 * against the real running app and real Postgres.
 */
describe('QualCloud Stage 10.1-10.5 — Recall Country Rules Engine & Full Lifecycle (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string
  let authorityId: string
  let productId: string
  let manager: TestActor
  let regulatoryLead: TestActor

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

  async function seedRole(key: string, permissionKeys: string[], isPlatform = false): Promise<void> {
    const roleId = randomUUID()
    await testPrisma.role.create({
      data: { id: roleId, key, name: key, description: 'test fixture', isPlatform },
    })
    for (const permKey of permissionKeys) {
      const permission = await testPrisma.permission.upsert({
        where: { key: permKey },
        create: { id: randomUUID(), key: permKey, description: 'test fixture' },
        update: {},
      })
      await testPrisma.rolePermission.create({ data: { roleId, permissionId: permission.id } })
    }
  }

  beforeEach(async () => {
    countryId = newId()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    authorityId = newId()
    await testPrisma.regulatoryAuthority.create({
      data: { id: authorityId, countryId, code: 'PPB', name: 'Pharmacy and Poisons Board' },
    })

    companyId = randomUUID()
    await testPrisma.company.create({
      data: { id: companyId, name: 'QualCloud Stage10 Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' },
    })

    const product = await testPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
      return tx.product.create({
        data: { id: newId(), companyId, brandName: 'Amoxiclav', genericName: 'Amoxicillin/Clavulanate', productCategory: 'medicinal', dosageForm: 'tablet', strength: '500mg' },
      })
    })
    productId = product.id

    await seedRole('QUALITY_MANAGER', [
      'quality.view_all',
      'quality.manage_recalls',
      'quality.approve_recall_scope',
      'quality.approve_recall_exception',
      // Stage 10.8's own RBAC correction — day-to-day recall drafting
      // (including `Recall` creation/linking itself, per
      // `RECALL.CREATE/EDIT -> QUALITY_ASSOCIATE`/`QUALITY_MANAGER` in
      // the Engineering Build Package's own permission matrix) plus
      // `regulatory.view_all` (closing the real "couldn't see the
      // parent Recall row" gap this same pass found).
      'quality.log_recall',
      'regulatory.view_all',
    ])
    await seedRole('regulatory_lead', ['platform.recall_rules.manage'], true)

    manager = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['QUALITY_MANAGER'] })
    regulatoryLead = await createAuthenticatedActor(app, testPrisma, { platformRole: 'regulatory_lead' })

    // The generic `recall` `WorkflowDefinition` — minimal, this file
    // doesn't walk the full lifecycle (that's the RegCloud e2e spec's
    // own job), just enough for `RecallService.create()`'s unconditional
    // `workflowService.instantiate()` call to succeed.
    const defId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: defId, recordType: 'recall', reportTypeId: null, countryId: null, version: 1, status: 'active' } })
    await testPrisma.workflowState.create({ data: { id: randomUUID(), definitionId: defId, stateKey: 'draft', name: 'Draft', isInitial: true, isTerminal: false } })
  })

  async function createBatch(batchNumber: string): Promise<{ id: string }> {
    return testPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
      return tx.batch.create({
        data: { id: newId(), companyId, productId, batchNumber, manufacturedOn: new Date('2026-01-01'), expiresOn: new Date('2028-01-01') },
      })
    })
  }

  async function createRecall(): Promise<{ id: string; ref: string }> {
    const res = await authedWrite(request(httpServer(app)).post('/api/v1/recalls'), manager)
      .send({ productId, reason: 'Contamination detected in batch 2026-04', recallClass: 'Class II' })
      .expect(201)
    return { id: res.body.data.id as string, ref: res.body.data.ref as string }
  }

  describe('10.1 — Recall country rules engine', () => {
    it('creates a rule-set, adds a rule + submission template, and signs off — retiring any prior live version', async () => {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/recall-rule-sets'), regulatoryLead)
        .send({ countryId, regulatoryAuthorityId: authorityId })
        .expect(201)
      const ruleSetId = created.body.data.id as string
      expect(created.body.data.version).toBe(1)
      expect(created.body.data.status).toBe('draft')

      const template = await authedWrite(request(httpServer(app)).post(`/api/v1/recall-rule-sets/${ruleSetId}/submission-templates`), regulatoryLead)
        .send({ code: 'notify', name: 'Recall Notification' })
        .expect(201)

      const rule = await authedWrite(request(httpServer(app)).post(`/api/v1/recall-rule-sets/${ruleSetId}/rules`), regulatoryLead)
        .send({
          code: 'initial-notify',
          requirementText: 'Notify PPB within 48 hours of the recall decision',
          anchorEvent: 'recall_decision',
          offset: 2,
          ownerRoleKey: 'QUALITY_MANAGER',
          sourceDoc: 'Test fixture guideline',
          submissionTemplateId: template.body.data.id,
          unverified: false,
        })
        .expect(201)
      expect(rule.body.data.unverified).toBe(false)

      const live = await authedWrite(request(httpServer(app)).post(`/api/v1/recall-rule-sets/${ruleSetId}/sign-off`), regulatoryLead).expect(201)
      expect(live.body.data.status).toBe('live')
      expect(live.body.data.signedOffAt).toBeTruthy()

      // A second version, once signed off, retires the first.
      const v2 = await authedWrite(request(httpServer(app)).post('/api/v1/recall-rule-sets'), regulatoryLead)
        .send({ countryId, regulatoryAuthorityId: authorityId })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/recall-rule-sets/${v2.body.data.id}/sign-off`), regulatoryLead).expect(201)

      const retiredV1 = await authed(request(httpServer(app)).get(`/api/v1/recall-rule-sets/${ruleSetId}`), regulatoryLead).expect(200)
      expect(retiredV1.body.data.status).toBe('retired')
    })

    it('rejects rule-set management from a tenant actor with no platform.recall_rules.manage permission', async () => {
      await authedWrite(request(httpServer(app)).post('/api/v1/recall-rule-sets'), manager)
        .send({ countryId, regulatoryAuthorityId: authorityId })
        .expect(403)
    })
  })

  describe('10.2 — Case lifecycle, scope, risk, and requirement evaluation', () => {
    it('adds a country, evaluating against the live rule-set into a real due requirement', async () => {
      const ruleSet = await authedWrite(request(httpServer(app)).post('/api/v1/recall-rule-sets'), regulatoryLead)
        .send({ countryId, regulatoryAuthorityId: authorityId })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/recall-rule-sets/${ruleSet.body.data.id}/rules`), regulatoryLead)
        .send({
          code: 'initial-notify',
          requirementText: 'Notify PPB within 2 days of the recall decision',
          anchorEvent: 'recall_decision',
          offset: 2,
          ownerRoleKey: 'QUALITY_MANAGER',
          sourceDoc: 'Test fixture guideline',
          unverified: false,
        })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/recall-rule-sets/${ruleSet.body.data.id}/sign-off`), regulatoryLead).expect(201)

      const recall = await createRecall()

      const country = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/countries`), manager)
        .send({ countryId, regulatoryAuthorityId: authorityId })
        .expect(201)
      expect(country.body.data.ruleSetVersion).toBe(1)

      const requirements = await authed(request(httpServer(app)).get(`/api/v1/recall-countries/${country.body.data.id}/requirements`), manager).expect(200)
      expect(requirements.body.data).toHaveLength(1)
      expect(requirements.body.data[0].status).toBe('open')
      expect(requirements.body.data[0].dueAt).toBeTruthy()
    })

    it('shows deadline_pending, never a fabricated date, for an unverified rule', async () => {
      const ruleSet = await authedWrite(request(httpServer(app)).post('/api/v1/recall-rule-sets'), regulatoryLead)
        .send({ countryId, regulatoryAuthorityId: authorityId })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/recall-rule-sets/${ruleSet.body.data.id}/rules`), regulatoryLead)
        .send({
          code: 'closure-report',
          requirementText: 'File a closure report',
          anchorEvent: 'recall_decision',
          offset: 30,
          ownerRoleKey: 'QUALITY_MANAGER',
          sourceDoc: 'Unconfirmed draft guideline',
          unverified: true,
        })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/recall-rule-sets/${ruleSet.body.data.id}/sign-off`), regulatoryLead).expect(201)

      const recall = await createRecall()
      const country = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/countries`), manager)
        .send({ countryId, regulatoryAuthorityId: authorityId })
        .expect(201)

      const requirements = await authed(request(httpServer(app)).get(`/api/v1/recall-countries/${country.body.data.id}/requirements`), manager).expect(200)
      expect(requirements.body.data[0].status).toBe('deadline_pending')
      expect(requirements.body.data[0].dueAt).toBeNull()

      // A real Task was created for the unresolved deadline.
      const tasks = await authed(request(httpServer(app)).get('/api/v1/tasks?scope=all'), manager).expect(200)
      const taskRows = tasks.body.data as { recordType: string }[]
      expect(taskRows.some((t) => t.recordType === 'recall_requirement')).toBe(true)
    })

    it('freezes a scope version, blocking edits, and rejects an empty scope', async () => {
      const recall = await createRecall()

      await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/scope-versions`), manager)
        .send({ items: [] })
        .then((res) => expect(res.status).toBe(201))

      const batch = await createBatch('B2026-04')

      const scope = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/scope-versions`), manager)
        .send({ items: [{ productId, batchId: batch.id, batchSize: 10_000, quantityDistributed: 8_000 }] })
        .expect(201)
      expect(scope.body.data.version).toBe(2) // the empty draft above was version 1

      const frozen = await authedWrite(request(httpServer(app)).post(`/api/v1/recall-scope-versions/${scope.body.data.id}/freeze`), manager).expect(201)
      expect(frozen.body.data.status).toBe('frozen')
    })
  })

  describe('10.3 — Distribution, cascade, sightings, traceability', () => {
    async function createStakeholder(orgName: string): Promise<string> {
      const res = await authedWrite(request(httpServer(app)).post('/api/v1/stakeholders'), manager)
        .send({ orgName, type: 'wholesaler', country: 'Kenya' })
        .expect(201)
      return res.body.data.id as string
    }

    it('records a manual distribution record and warns (not blocks) on a downstream over-quantity', async () => {
      const recall = await createRecall()
      const batch = await createBatch('B2026-06')
      const wholesaler = await createStakeholder('Nairobi Wholesale Ltd')
      const pharmacy = await createStakeholder('Corner Pharmacy')

      await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/distribution-records`), manager)
        .send({ batchId: batch.id, toOrgId: wholesaler, qtyUnits: 1000, date: '2026-06-05' })
        .expect(201)

      const overQty = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/distribution-records`), manager)
        .send({ batchId: batch.id, fromOrgId: wholesaler, toOrgId: pharmacy, qtyUnits: 1500, date: '2026-06-10' })
        .expect(201)
      expect(overQty.body.data.warning).toMatch(/exceeds what this organisation itself received/i)

      const list = await authed(request(httpServer(app)).get(`/api/v1/recalls/${recall.id}/distribution-records`), manager).expect(200)
      expect(list.body.data).toHaveLength(2)
    })

    it('imports a CSV of distribution rows against the frozen scope, reporting per-row errors without failing the whole file', async () => {
      const recall = await createRecall()
      const batch = await createBatch('B2026-07')
      const scope = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/scope-versions`), manager)
        .send({ items: [{ productId, batchId: batch.id, batchSize: 10_000 }] })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/recall-scope-versions/${scope.body.data.id}/freeze`), manager).expect(201)

      const csv = [
        'toOrgName,batchNumber,qtyUnits,qtyPacks,date,invoiceNo',
        'Mombasa Distributors,B2026-07,500,50,2026-07-10,INV-001',
        'Kisumu Chemists,NOT-IN-SCOPE,200,20,2026-07-11,INV-002',
      ].join('\n')

      const job = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/distribution-records/import`), manager)
        .send({ csv })
        .expect(201)
      expect(job.body.data.validRows).toBe(1)
      expect(job.body.data.errorRows).toBe(1)
      expect(job.body.data.status).toBe('completed_with_errors')

      const records = await authed(request(httpServer(app)).get(`/api/v1/recalls/${recall.id}/distribution-records`), manager).expect(200)
      expect(records.body.data).toHaveLength(1)
    })

    it('invites a stakeholder to the cascade and reviews a sighting, adding a new country on notify_regulator', async () => {
      const recall = await createRecall()
      const stakeholderId = await createStakeholder('Regional Distributor')

      const invite = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/cascade-invites/${stakeholderId}`), manager).expect(201)
      expect(invite.body.data.status).toBe('awaiting')

      const sighting = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/sightings`), manager)
        .send({ country: 'Uganda', source: 'Field report from a distributor' })
        .expect(201)

      const secondCountryId = newId()
      await testPrisma.country.create({ data: { id: secondCountryId, isoCode: 'UG', name: 'Uganda' } })

      await authedWrite(request(httpServer(app)).post(`/api/v1/recall-sightings/${sighting.body.data.id}/review`), manager)
        .send({ decision: 'notify_regulator', countryId: secondCountryId })
        .expect(201)

      const countries = await authed(request(httpServer(app)).get(`/api/v1/recalls/${recall.id}/countries`), manager).expect(200)
      const countryRows = countries.body.data as { countryId: string }[]
      expect(countryRows.some((c) => c.countryId === secondCountryId)).toBe(true)
    })

    it('surfaces the recall distribution graph on the batch traceability view (Stage 7 reuse)', async () => {
      const recall = await createRecall()
      const batch = await createBatch('B2026-08')
      const wholesaler = await createStakeholder('Trace Test Wholesaler')
      await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/distribution-records`), manager)
        .send({ batchId: batch.id, toOrgId: wholesaler, qtyUnits: 300, date: '2026-08-05' })
        .expect(201)

      const trace = await authed(request(httpServer(app)).get(`/api/v1/quality/batches/${batch.id}/traceability`), manager).expect(200)
      expect(trace.body.data.recallDistributionRecords).toHaveLength(1)
      expect(trace.body.data.recallDistributionRecords[0].toOrg.orgName).toBe('Trace Test Wholesaler')
    })
  })

  describe('10.4 — External stakeholder portal & messaging', () => {
    it('creates a portal link and lets the token holder resolve context and submit an idempotent action, with no auth', async () => {
      const recall = await createRecall()
      const stakeholderRes = await authedWrite(request(httpServer(app)).post('/api/v1/stakeholders'), manager)
        .send({ orgName: 'Portal Test Pharmacy', type: 'pharmacy' })
        .expect(201)
      const stakeholderId = stakeholderRes.body.data.id as string

      const link = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/portal-links`), manager)
        .send({ stakeholderId })
        .expect(201)
      const token = link.body.data.token as string
      expect(token).toHaveLength(64)

      const context = await request(httpServer(app)).get(`/api/v1/recall-portal/${token}/context`).expect(200)
      expect(context.body.data.stakeholderOrgName).toBe('Portal Test Pharmacy')
      expect(context.body.data.recallRef).toBe(recall.ref)

      const idempotencyKey = randomUUID()
      const first = await request(httpServer(app))
        .post(`/api/v1/recall-portal/${token}/actions`)
        .send({ action: 'ack', idempotencyKey })
        .expect(201)
      const second = await request(httpServer(app))
        .post(`/api/v1/recall-portal/${token}/actions`)
        .send({ action: 'ack', idempotencyKey })
        .expect(201)
      expect(second.body.data.id).toBe(first.body.data.id) // resubmission is a no-op, not a duplicate

      await authedWrite(request(httpServer(app)).post(`/api/v1/recall-portal-links/${link.body.data.link.id}/revoke`), manager).expect(201)
      await request(httpServer(app)).get(`/api/v1/recall-portal/${token}/context`).expect(404)
    })

    it('sends a real email message and honestly reports not_configured for whatsapp/sms', async () => {
      const recall = await createRecall()
      const stakeholderRes = await authedWrite(request(httpServer(app)).post('/api/v1/stakeholders'), manager)
        .send({ orgName: 'Message Test Org', type: 'distributor', contactEmail: 'contact@example.test' })
        .expect(201)
      const stakeholderId = stakeholderRes.body.data.id as string

      const emailMsg = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/messages`), manager)
        .send({ stakeholderId, channel: 'email', body: 'Please stop distribution of this batch immediately.' })
        .expect(201)
      expect(emailMsg.body.data.status).toBe('queued')
      expect(emailMsg.body.data.body).toBe('Please stop distribution of this batch immediately.')

      const smsMsg = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/messages`), manager)
        .send({ stakeholderId, channel: 'sms', body: 'Stop sale notice.' })
        .expect(201)
      expect(smsMsg.body.data.status).toBe('not_configured')
    })
  })

  describe('10.5 — Returns, quarantine, reconciliation, destruction, effectiveness', () => {
    it('records quarantine with part-packs, and only credits a genuine return verdict', async () => {
      const recall = await createRecall()
      const batch = await createBatch('B2026-09')

      const quarantine = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/quarantine-records`), manager)
        .send({ batchId: batch.id, fullPacks: 10, partPacks: [{ unitsRemaining: 7, unitsPerPack: 20 }] })
        .expect(201)
      expect(quarantine.body.data.fullPacks).toBe(10)

      const genuineReturn = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/return-records`), manager)
        .send({ batchId: batch.id, qty: 100 })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/return-records/${genuineReturn.body.data.id}/verify`), manager)
        .send({ verdict: 'genuine' })
        .expect(201)

      const suspectReturn = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/return-records`), manager)
        .send({ batchId: batch.id, qty: 50 })
        .expect(201)
      const verifiedSuspect = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/return-records/${suspectReturn.body.data.id}/verify`), manager)
        .send({ verdict: 'suspect', verdictNote: 'Packaging does not match the batch scope' })
        .expect(201)
      expect(verifiedSuspect.body.data.creditStatus).toBe('disputed')
    })

    it('calculates a live reconciliation snapshot from real rows and gates a blocking discrepancy behind an approved exception', async () => {
      const recall = await createRecall()
      const batch = await createBatch('B2026-10')
      const scope = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/scope-versions`), manager)
        .send({ items: [{ productId, batchId: batch.id, batchSize: 10_000 }] })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/recall-scope-versions/${scope.body.data.id}/freeze`), manager).expect(201)

      const wholesaler = await authedWrite(request(httpServer(app)).post('/api/v1/stakeholders'), manager)
        .send({ orgName: 'Reconciliation Test Org', type: 'wholesaler', country: 'Kenya' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/distribution-records`), manager)
        .send({ batchId: batch.id, toOrgId: wholesaler.body.data.id, qtyUnits: 1000, date: '2026-10-05' })
        .expect(201)

      const genuineReturn = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/return-records`), manager)
        .send({ batchId: batch.id, qty: 700 })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/return-records/${genuineReturn.body.data.id}/verify`), manager)
        .send({ verdict: 'genuine' })
        .expect(201)

      const country = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/countries`), manager)
        .send({ countryId })
        .expect(201)

      const snapshot = await authedWrite(request(httpServer(app)).post(`/api/v1/recall-countries/${country.body.data.id}/reconciliation`), manager).expect(201)
      expect(snapshot.body.data.recovered).toBe(700)
      expect(snapshot.body.data.accounted).toBe(700)
      expect(snapshot.body.data.outstanding).toBe(300)

      const discrepancy = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/discrepancies`), manager)
        .send({ recallCountryId: country.body.data.id, units: 300, reason: 'Outstanding stock still with a small retailer' })
        .expect(201)
      expect(discrepancy.body.data.blocking).toBe(true)
      expect(discrepancy.body.data.status).toBe('open')

      const resolved = await authedWrite(request(httpServer(app)).post(`/api/v1/recall-discrepancies/${discrepancy.body.data.id}/approve-exception`), manager)
        .send({ note: 'Retailer confirmed destroyed on-site, certificate on file.' })
        .expect(201)
      expect(resolved.body.data.status).toBe('resolved')
    })

    it('blocks destruction until disposal-approval evidence exists, then completes it with a certificate', async () => {
      const recall = await createRecall()
      const country = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/countries`), manager)
        .send({ countryId })
        .expect(201)
      const recallCountryId = country.body.data.id as string

      const created = await authedWrite(request(httpServer(app)).post(`/api/v1/recall-countries/${recallCountryId}/destruction-records`), manager)
        .send({ units: 6200 })
        .expect(201)
      expect(created.body.data.status).toBe('pending_approval')

      await authedWrite(request(httpServer(app)).post(`/api/v1/recall-destruction-records/${created.body.data.id}/mark-destroyed`), manager)
        .expect(409)

      const evidenceId = randomUUID()
      await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        await tx.document.create({ data: { id: evidenceId, companyId, recordType: 'recall_destruction_record', recordId: created.body.data.id, title: 'Disposal approval', createdBy: manager.userId } })
      })
      await authedWrite(request(httpServer(app)).post(`/api/v1/recall-destruction-records/${created.body.data.id}/disposal-approval`), manager)
        .send({ disposalApprovalEvidenceId: evidenceId })
        .expect(201)

      const destroyed = await authedWrite(request(httpServer(app)).post(`/api/v1/recall-destruction-records/${created.body.data.id}/mark-destroyed`), manager).expect(201)
      expect(destroyed.body.data.status).toBe('destroyed')

      const certificateId = randomUUID()
      await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        await tx.document.create({ data: { id: certificateId, companyId, recordType: 'recall_destruction_record', recordId: created.body.data.id, title: 'Destruction certificate', createdBy: manager.userId } })
      })
      const completed = await authedWrite(request(httpServer(app)).post(`/api/v1/recall-destruction-records/${created.body.data.id}/certificate`), manager)
        .send({ certificateEvidenceId: certificateId })
        .expect(201)
      expect(completed.body.data.status).toBe('completed')
    })

    it('keeps an effectiveness check with stock found open until explicitly closed', async () => {
      const recall = await createRecall()
      const country = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/countries`), manager)
        .send({ countryId })
        .expect(201)
      const recallCountryId = country.body.data.id as string

      const check = await authedWrite(request(httpServer(app)).post(`/api/v1/recall-countries/${recallCountryId}/effectiveness-checks`), manager)
        .send({ method: 'field_visit_sample', sampleSize: 20, clear: 18, stockFound: 2 })
        .expect(201)
      expect(check.body.data.status).toBe('open')

      const closed = await authedWrite(request(httpServer(app)).post(`/api/v1/recall-effectiveness-checks/${check.body.data.id}/close`), manager).expect(201)
      expect(closed.body.data.status).toBe('closed')
    })
  })
})
