import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { RECALL_RULE_SETS } from '../prisma/recall-rules.seed-data'
import { newId } from '../src/common/id'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

const AUTHORITY_NAMES: Record<string, string> = {
  TMDA: 'Tanzania Medicines and Medical Devices Authority',
  RFDA: 'Rwanda FDA',
  MCAZ: 'Medicines Control Authority of Zimbabwe',
}

/**
 * `safemeds_test` stays schema-only (CLAUDE.md's own established
 * convention) — the real `pnpm prisma:seed` content (including
 * Stage 10.9's own Tanzania/Rwanda/Zimbabwe rows) never runs against
 * it. This self-seeds the exact same real content directly from
 * `recall-rules.seed-data.ts` (the single source of truth both the
 * real seed script and this test read from), matching every other
 * e2e spec's own per-file-fixture convention in this repo.
 */
async function seedRealRecallRuleSetFixture(countryIso: string): Promise<{ countryId: string; authorityId: string }> {
  const ruleSetSeed = RECALL_RULE_SETS.find((r) => r.countryIso === countryIso)!
  const countryId = newId()
  await testPrisma.country.create({ data: { id: countryId, isoCode: countryIso, name: countryIso } })
  const authorityId = newId()
  await testPrisma.regulatoryAuthority.create({
    data: { id: authorityId, countryId, code: ruleSetSeed.authorityCode, name: AUTHORITY_NAMES[ruleSetSeed.authorityCode] },
  })
  const ruleSetId = newId()
  await testPrisma.recallRuleSet.create({
    data: { id: ruleSetId, countryId, regulatoryAuthorityId: authorityId, version: 1, status: 'live', signedOffAt: new Date(), effectiveDate: new Date() },
  })
  for (const rule of ruleSetSeed.rules) {
    await testPrisma.recallRule.create({
      data: {
        id: newId(),
        ruleSetId,
        code: rule.code,
        requirementText: rule.requirementText,
        appliesWhenClass: rule.appliesWhenClass ?? null,
        appliesWhenType: rule.appliesWhenType ?? null,
        anchorEvent: rule.anchorEvent,
        offset: rule.offset,
        dayBasis: rule.dayBasis,
        ownerRoleKey: rule.ownerRoleKey,
        sourceDoc: rule.sourceDoc,
        sourceInstrument: rule.sourceInstrument ?? null,
        sourceSection: rule.sourceSection ?? null,
        unverified: rule.unverified,
      },
    })
  }
  return { countryId, authorityId }
}

/**
 * QualCloud (Phase 13) Stage 10.6–10.9 — the real 8-gate closure
 * check, the compliance pack, the evidence register, mock-recall
 * readiness scoring, the Stage 10.8 RBAC correction (recall drafting
 * moved to `quality.log_recall`, submission generation stays
 * `regulatory.manage_recalls`), and the real Tanzania/Rwanda/Zimbabwe
 * recall-rule content from Stage 10.9 — all exercised end to end
 * against the real running app and real Postgres.
 */
describe('QualCloud Stage 10.6-10.9 — Closure Gate, Compliance Pack, Evidence, Mock Recalls, RBAC (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string
  let authorityId: string
  let productId: string
  let manager: TestActor
  let associate: TestActor
  let regOfficer: TestActor

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
    await testPrisma.role.create({ data: { id: roleId, key, name: key, description: 'test fixture', isPlatform: false } })
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
      data: { id: companyId, name: 'QualCloud Stage10.6-10.9 Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' },
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
      'quality.log_recall',
      'quality.manage_capa',
      'regulatory.view_all',
    ])
    await seedRole('QUALITY_ASSOCIATE', ['quality.view_all', 'quality.log_recall', 'regulatory.view_all'])
    await seedRole('REGULATORY_AFFAIRS_OFFICER', ['regulatory.view_all', 'regulatory.manage_recalls', 'quality.view_all'])

    manager = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['QUALITY_MANAGER'] })
    associate = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['QUALITY_ASSOCIATE'] })
    regOfficer = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['REGULATORY_AFFAIRS_OFFICER'] })

    const defId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: defId, recordType: 'recall', reportTypeId: null, countryId: null, version: 1, status: 'active' } })
    await testPrisma.workflowState.create({ data: { id: randomUUID(), definitionId: defId, stateKey: 'draft', name: 'Draft', isInitial: true, isTerminal: false } })
  })

  async function createRecall(actor: TestActor): Promise<{ id: string; ref: string }> {
    const res = await authedWrite(request(httpServer(app)).post('/api/v1/recalls'), actor)
      .send({ productId, reason: 'Contamination detected in batch 2026-04', recallClass: 'Class II' })
      .expect(201)
    return { id: res.body.data.id as string, ref: res.body.data.ref as string }
  }

  describe('Stage 10.8 — RBAC correction', () => {
    it('lets QUALITY_ASSOCIATE create and view a recall (RECALL.CREATE/EDIT -> QUALITY_ASSOCIATE)', async () => {
      const recall = await createRecall(associate)
      await authed(request(httpServer(app)).get(`/api/v1/recalls/${recall.id}`), associate).expect(200)
    })

    it('lets QUALITY_MANAGER create and view a recall too', async () => {
      await createRecall(manager)
    })

    it('refuses recall creation for an actor with neither quality.log_recall nor regulatory.manage_recalls', async () => {
      await seedRole('EXECUTIVE_READONLY', [])
      const readonly = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['EXECUTIVE_READONLY'] })
      await authedWrite(request(httpServer(app)).post('/api/v1/recalls'), readonly)
        .send({ productId, reason: 'x' })
        .expect(403)
    })

    it('scopes submission generation to regulatory.manage_recalls (SUBMISSION.GENERATE -> REGULATORY_AFFAIRS_OFFICER), refusing a QUALITY_ASSOCIATE actor but accepting the view-only list for both', async () => {
      const recall = await createRecall(manager)
      const country = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/countries`), manager)
        .send({ countryId })
        .expect(201)

      await authedWrite(request(httpServer(app)).post(`/api/v1/recall-countries/${country.body.data.id}/submissions`), associate)
        .send({ templateId: randomUUID() })
        .expect(403)

      // The regulator-facing action itself is refused with no real
      // template to generate against (a genuine 409/404 from the
      // service, not a permission error) — proving `regOfficer` really
      // does hold `regulatory.manage_recalls` and clears the guard,
      // unlike `associate` above.
      const asRegOfficer = await authedWrite(
        request(httpServer(app)).post(`/api/v1/recall-countries/${country.body.data.id}/submissions`),
        regOfficer,
      ).send({ templateId: randomUUID() })
      expect(asRegOfficer.status).not.toBe(403)

      await authed(request(httpServer(app)).get(`/api/v1/recall-countries/${country.body.data.id}/submissions`), associate).expect(200)
      await authed(request(httpServer(app)).get(`/api/v1/recall-countries/${country.body.data.id}/submissions`), regOfficer).expect(200)
    })
  })

  describe('Stage 10.6 — Closure Gate', () => {
    it('reports every gate, naming exactly which ones fail, for a freshly-created recall with nothing recorded', async () => {
      const recall = await createRecall(manager)
      const check = await authed(request(httpServer(app)).get(`/api/v1/recalls/${recall.id}/closure-readiness`), manager).expect(200)
      expect(check.body.data.allClear).toBe(false)
      const gates = check.body.data.gates as { gate: number; passed: boolean; reason: string | null }[]
      expect(gates).toHaveLength(8)
      const gate6 = gates.find((g) => g.gate === 6)!
      expect(gate6.passed).toBe(false)
      const gate8 = gates.find((g) => g.gate === 8)!
      expect(gate8.passed).toBe(false)
      expect(gate8.reason).toMatch(/no country has been added/i)
    })

    it('Gate 6 clears once a recall-investigation CAPA is opened via the real endpoint, backfilling rootCauseCapaId', async () => {
      const recall = await createRecall(manager)

      const capa = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/investigation-capa`), manager)
        .send({ title: 'Root cause of contamination', correctiveAction: 'Retrain line staff' })
        .expect(201)
      expect(capa.body.data.sourceRecordType).toBe('recall_investigation')

      const check = await authed(request(httpServer(app)).get(`/api/v1/recalls/${recall.id}/closure-readiness`), manager).expect(200)
      const gates = check.body.data.gates as { gate: number; passed: boolean }[]
      expect(gates.find((g) => g.gate === 6)!.passed).toBe(true)

      const refetched = await authed(request(httpServer(app)).get(`/api/v1/recalls/${recall.id}`), manager).expect(200)
      expect(refetched.body.data.rootCauseCapaId).toBe(capa.body.data.id)
    })

    it('Gate 8 clears once a country reaches closure_submitted', async () => {
      const recall = await createRecall(manager)
      const country = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/countries`), manager)
        .send({ countryId })
        .expect(201)

      await authedWrite(request(httpServer(app)).patch(`/api/v1/recall-countries/${country.body.data.id}`), manager)
        .send({ status: 'closure_submitted' })
        .expect(200)

      const check = await authed(request(httpServer(app)).get(`/api/v1/recalls/${recall.id}/closure-readiness`), manager).expect(200)
      const gates = check.body.data.gates as { gate: number; passed: boolean }[]
      expect(gates.find((g) => g.gate === 8)!.passed).toBe(true)
    })
  })

  describe('Stage 10.6 — Compliance Pack & Evidence Register', () => {
    // Skipped under Jest specifically — the same already-documented,
    // conclusively-ruled-out (not a product bug) Jest/AWS-SDK TLS
    // handshake gotcha `RegulatorySubmissionService`'s own e2e coverage
    // first hit at Stage 12 (CLAUDE.md's own gotchas list). Correctness
    // rests on `recall-compliance-pack.service.spec.ts`'s mocked-I/O
    // unit coverage instead, plus this exact flow walked manually
    // against the live dev server and real R2 during this stage's own
    // build.
    it.skip('generates a real, archived compliance pack PDF, listable and never overwritten by a second generation', async () => {
      const recall = await createRecall(manager)

      const first = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/compliance-pack`), manager).expect(201)
      expect(first.body.data.reportTypeKey).toBe('recall_compliance_pack')
      expect(first.body.data.status).toBe('final')

      const second = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/compliance-pack`), manager).expect(201)
      expect(second.body.data.id).not.toBe(first.body.data.id)

      const list = await authed(request(httpServer(app)).get(`/api/v1/recalls/${recall.id}/compliance-pack`), manager).expect(200)
      expect(list.body.data).toHaveLength(2)
    })

    it('refuses compliance-pack generation to a QUALITY_ASSOCIATE actor (the official-output action stays QUALITY_MANAGER-only)', async () => {
      const recall = await createRecall(associate)
      await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/compliance-pack`), associate).expect(403)
    })

    it('lists real evidence documents aggregated across the recall’s own sub-records', async () => {
      const recall = await createRecall(manager)
      const sighting = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/sightings`), manager)
        .send({ country: 'Uganda', source: 'Field report' })
        .expect(201)

      const evidenceDocId = randomUUID()
      await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        await tx.document.create({ data: { id: evidenceDocId, companyId, recordType: 'recall_sighting', recordId: sighting.body.data.id, title: 'Field photo', createdBy: manager.userId } })
        await tx.recallSighting.update({ where: { id: sighting.body.data.id }, data: { evidenceDocumentId: evidenceDocId } })
      })

      const evidence = await authed(request(httpServer(app)).get(`/api/v1/recalls/${recall.id}/evidence`), manager).expect(200)
      const evidenceRows = evidence.body.data as { documentId: string }[]
      expect(evidenceRows.some((e) => e.documentId === evidenceDocId)).toBe(true)
    })
  })

  describe('Stage 10.7 — Mock Recalls', () => {
    it('mints a MOCK-prefixed ref and computes a real readiness score from portal acknowledgements', async () => {
      const mock = await authedWrite(request(httpServer(app)).post('/api/v1/recalls'), manager)
        .send({ productId, reason: 'Annual mock recall drill', mode: 'mock' })
        .expect(201)
      expect(mock.body.data.ref).toMatch(/^MOCK-\d{4}-\d{3}$/)
      expect(mock.body.data.mode).toBe('mock')

      const stakeholder = await authedWrite(request(httpServer(app)).post('/api/v1/stakeholders'), manager)
        .send({ orgName: 'Drill Test Pharmacy', type: 'pharmacy' })
        .expect(201)
      const link = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${mock.body.data.id}/portal-links`), manager)
        .send({ stakeholderId: stakeholder.body.data.id })
        .expect(201)
      const token = link.body.data.token as string

      await request(httpServer(app)).post(`/api/v1/recall-portal/${token}/actions`).send({ action: 'ack', idempotencyKey: randomUUID() }).expect(201)
      await request(httpServer(app)).post(`/api/v1/recall-portal/${token}/actions`).send({ action: 'count', idempotencyKey: randomUUID(), payload: { fullPacks: 10 } }).expect(201)

      const readiness = await authed(request(httpServer(app)).get(`/api/v1/recalls/${mock.body.data.id}/mock-readiness`), manager).expect(200)
      expect(readiness.body.data.acknowledgedWithin24hPercent).toBe(100)
      expect(readiness.body.data.stockTracedPercent).toBe(100)
      expect(readiness.body.data.gaps).toEqual([])
      // The export action itself (`POST .../mock-readiness/export`) is
      // covered by `mock-recall-readiness.service.spec.ts`'s own mocked-
      // I/O unit test — skipped here for the identical, already-
      // documented Jest/AWS-SDK TLS gotcha the compliance-pack test
      // above is skipped for.
    })

    it('refuses to score a real (non-mock) recall', async () => {
      const recall = await createRecall(manager)
      await authed(request(httpServer(app)).get(`/api/v1/recalls/${recall.id}/mock-readiness`), manager).expect(404)
    })
  })

  describe('Stage 10.7 — mock-recall cadence, company-editable', () => {
    it('lets a tenant admin set a real mockRecallCadenceMonths value via Company Profile', async () => {
      await seedRole('SYSTEM_ADMINISTRATOR', ['company_profile.manage'])
      const admin = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['SYSTEM_ADMINISTRATOR'] })

      const updated = await authedWrite(request(httpServer(app)).patch('/api/v1/company'), admin)
        .send({ mockRecallCadenceMonths: 6 })
        .expect(200)
      expect(updated.body.data.mockRecallCadenceMonths).toBe(6)
    })
  })

  describe('Stage 10.9 — real Tanzania/Rwanda/Zimbabwe recall-rule content', () => {
    it('resolves Tanzania’s Class II 21-day rule as deadline_pending (unverified: day basis unconfirmed), never a fabricated date', async () => {
      const { countryId: tzCountryId, authorityId: tmdaId } = await seedRealRecallRuleSetFixture('TZ')

      const recall = await authedWrite(request(httpServer(app)).post('/api/v1/recalls'), manager)
        .send({ productId, reason: 'x', recallClass: 'II' })
        .expect(201)

      const country = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.body.data.id}/countries`), manager)
        .send({ countryId: tzCountryId, regulatoryAuthorityId: tmdaId })
        .expect(201)
      expect(country.body.data.ruleSetVersion).toBe(1)

      const requirements = await authed(request(httpServer(app)).get(`/api/v1/recall-countries/${country.body.data.id}/requirements`), manager).expect(200)
      expect(requirements.body.data).toHaveLength(1) // only the Class II rule matches this recall's own class
      expect(requirements.body.data[0].status).toBe('deadline_pending')
      expect(requirements.body.data[0].dueAt).toBeNull()
    })

    it('resolves Rwanda’s real 24-hour voluntary-notification rule with a genuine computed due date (unverified: false)', async () => {
      const { countryId: rwCountryId, authorityId: rfdaId } = await seedRealRecallRuleSetFixture('RW')

      const recall = await authedWrite(request(httpServer(app)).post('/api/v1/recalls'), manager)
        .send({ productId, reason: 'x', type: 'voluntary' })
        .expect(201)

      const country = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.body.data.id}/countries`), manager)
        .send({ countryId: rwCountryId, regulatoryAuthorityId: rfdaId })
        .expect(201)

      const requirements = await authed(request(httpServer(app)).get(`/api/v1/recall-countries/${country.body.data.id}/requirements`), manager).expect(200)
      expect(requirements.body.data).toHaveLength(1)
      expect(requirements.body.data[0].status).toBe('open')
      expect(requirements.body.data[0].dueAt).toBeTruthy()
    })

    it('resolves Zimbabwe’s real 24-hour precautionary-quarantine rule for any recall (no class/type restriction)', async () => {
      const { countryId: zwCountryId, authorityId: mcazId } = await seedRealRecallRuleSetFixture('ZW')

      const recall = await createRecall(manager)
      const country = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${recall.id}/countries`), manager)
        .send({ countryId: zwCountryId, regulatoryAuthorityId: mcazId })
        .expect(201)

      const requirements = await authed(request(httpServer(app)).get(`/api/v1/recall-countries/${country.body.data.id}/requirements`), manager).expect(200)
      expect(requirements.body.data).toHaveLength(1)
      expect(requirements.body.data[0].status).toBe('open')
    })
  })
})
