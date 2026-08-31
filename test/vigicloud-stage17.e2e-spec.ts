import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { SIGNAL_WORKFLOW_RECORD_TYPE, SIGNAL_WORKFLOW_STATES, SIGNAL_WORKFLOW_TRANSITIONS } from '../prisma/workflow.seed-data'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

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

async function seedRoleWithPermissions(roleKey: string, permissionKeys: string[]): Promise<string> {
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
  return role.id
}

function buildCasePayload(overrides: Record<string, unknown> = {}, refs: { reportTypeId: string; countryId: string }) {
  return {
    reportTypeId: refs.reportTypeId,
    countryOfOccurrenceId: refs.countryId,
    countryOfReportId: refs.countryId,
    channel: 'form',
    awarenessDate: '2026-08-01',
    receivedDate: '2026-08-02',
    reporter: { reporterType: 'consumer', fullName: 'A Reporter', email: 'reporter@example.com', organization: 'Meridian Pharma' },
    patient: { initials: 'J.M.', ageYears: 34, sex: 'female' },
    suspectProducts: [{ drugCharacterization: 'suspect', medicinalProduct: 'Depo-Provera', activeSubstanceName: 'Medroxyprogesterone', batchNumber: 'B12345' }],
    adverseEvents: [{ reportedTerm: 'Injection site reaction', narrative: 'Localized reaction within an hour of dosing' }],
    ...overrides,
  }
}

/**
 * VigiCloud Stage 17 — Signal Management (GVP Module IX). Real HTTP
 * coverage against a real seeded company, matching every prior stage's
 * own e2e conventions. Self-contained (doesn't depend on `pnpm
 * prisma:seed`): seeds both a minimal `pv_case` workflow fixture (so
 * real cases can exist as detection evidence) and the full 9-state/
 * 8-transition `signal` workflow fixture from `SIGNAL_WORKFLOW_STATES`/
 * `SIGNAL_WORKFLOW_TRANSITIONS` directly, exactly as shipped in
 * `prisma/workflow.seed-data.ts`.
 */
describe('VigiCloud Stage 17 — Signal Management (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string
  let reportTypeId: string
  let qppv: TestActor
  let viewOnlyActor: TestActor
  let noPermActor: TestActor

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
    await testPrisma.company.create({ data: { id: companyId, name: 'Stage17 Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })
    reportTypeId = randomUUID()
    await testPrisma.reportType.create({ data: { id: reportTypeId, typeKey: `adr_e2e_${randomUUID()}`, name: 'Suspected ADR' } })

    // Minimal pv_case workflow — evidence cases only ever need to exist at Intake, no transitions required for this stage's own tests.
    const caseDefinitionId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: caseDefinitionId, recordType: 'pv_case', reportTypeId: null, countryId: null, version: 1, status: 'active' } })
    await testPrisma.workflowState.create({ data: { id: randomUUID(), definitionId: caseDefinitionId, stateKey: 'intake', name: 'Intake', isInitial: true, isTerminal: false } })

    // Full signal workflow — every state and transition from the real seed data, so this spec genuinely exercises the shipped fixture, not a hand-trimmed stand-in.
    const qppvRoleId = await seedRoleWithPermissions('QPPV', ['pv.manage_signals', 'pv.view_all', 'pv.capture_case'])
    const signalDefinitionId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: signalDefinitionId, recordType: SIGNAL_WORKFLOW_RECORD_TYPE, reportTypeId: null, countryId: null, version: 1, status: 'active' } })
    const stateIdByKey = new Map<string, string>()
    for (const state of SIGNAL_WORKFLOW_STATES) {
      const id = randomUUID()
      stateIdByKey.set(state.key, id)
      await testPrisma.workflowState.create({ data: { id, definitionId: signalDefinitionId, stateKey: state.key, name: state.name, isInitial: state.isInitial, isTerminal: state.isTerminal } })
    }
    for (const t of SIGNAL_WORKFLOW_TRANSITIONS) {
      await testPrisma.workflowTransition.create({
        data: {
          id: randomUUID(),
          definitionId: signalDefinitionId,
          fromStateId: stateIdByKey.get(t.from)!,
          toStateId: stateIdByKey.get(t.to)!,
          requiredRoleId: qppvRoleId,
          requiresSignature: t.requiresSignature,
        },
      })
    }

    qppv = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['QPPV'] })

    await seedRoleWithPermissions('EXECUTIVE_READONLY_17', ['pv.view_all'])
    viewOnlyActor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['EXECUTIVE_READONLY_17'] })

    await seedRoleWithPermissions('NO_SIGNAL_PERMS_17', [])
    noPermActor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['NO_SIGNAL_PERMS_17'] })
  })

  async function createCase(overrides: Record<string, unknown> = {}): Promise<string> {
    const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), qppv)
      .send(buildCasePayload(overrides, { reportTypeId, countryId }))
      .expect(201)
    return created.body.data.id as string
  }

  async function instanceIdFor(signalId: string): Promise<string> {
    const instance = await testPrisma.workflowInstance.findFirstOrThrow({ where: { recordType: SIGNAL_WORKFLOW_RECORD_TYPE, recordId: signalId } })
    return instance.id
  }

  describe('Detection', () => {
    it('flags a real pattern via POST /pv/signals/scan: the same batch across 2 open cases at 2 distinct organizations', async () => {
      await createCase()
      await createCase({ reporter: { reporterType: 'consumer', fullName: 'A Second Reporter', email: 'reporter2@example.com', organization: 'Zenith Distributors' } })

      const scan = await authedWrite(request(httpServer(app)).post('/api/v1/pv/signals/scan'), qppv).expect(201)
      // The same evidence qualifies both the batch-specific and the broader product-wide pattern — two independent signals, per the service's own documented design.
      expect(scan.body.data.signalsCreated).toBe(2)
      expect(scan.body.data.casesLinked).toBe(4)

      const list = await authed(request(httpServer(app)).get('/api/v1/pv/signals'), qppv).expect(200)
      const signals = list.body.data as { id: string; detectionMethod: string; productIdentifier: string; batchNumber: string | null }[]
      expect(signals).toHaveLength(2)
      expect(signals.every((s) => s.detectionMethod === 'pattern_flag')).toBe(true)
      expect(signals.some((s) => s.batchNumber === 'B12345')).toBe(true)
      expect(signals.some((s) => s.batchNumber === null)).toBe(true)
    })

    it('does not flag the same product reported by a single organization', async () => {
      await createCase()
      await createCase()

      const scan = await authedWrite(request(httpServer(app)).post('/api/v1/pv/signals/scan'), qppv).expect(201)
      expect(scan.body.data.signalsCreated).toBe(0)
    })

    it('a re-scan is idempotent: no duplicate signal for an already-open matching pattern', async () => {
      await createCase()
      await createCase({ reporter: { reporterType: 'consumer', fullName: 'A Second Reporter', email: 'reporter2@example.com', organization: 'Zenith Distributors' } })
      await authedWrite(request(httpServer(app)).post('/api/v1/pv/signals/scan'), qppv).expect(201)

      const second = await authedWrite(request(httpServer(app)).post('/api/v1/pv/signals/scan'), qppv).expect(201)
      expect(second.body.data.signalsCreated).toBe(0)
    })
  })

  describe('Manual creation and evidence linking', () => {
    it('creates a signal manually, links cases at creation, and instantiates its workflow at Detected', async () => {
      const caseId = await createCase()

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/signals'), qppv)
        .send({ title: 'Depo-Provera cluster', description: 'Manually raised from a field report', productIdentifier: 'Depo-Provera', batchNumber: 'B12345', caseIds: [caseId] })
        .expect(201)

      expect(created.body.data.status).toBe('detected')
      expect(created.body.data.detectionMethod).toBe('manual')

      const detail = await authed(request(httpServer(app)).get(`/api/v1/pv/signals/${created.body.data.id}`), qppv).expect(200)
      expect(detail.body.data.linkedCases).toEqual([expect.objectContaining({ id: caseId })])
      expect(detail.body.data.status).toBe('detected')
    })

    it('testing-todo 17.2 — links a signal to a real product-catalog record via productId, traceable afterward', async () => {
      const productId = randomUUID()
      await withBypass((tx) =>
        tx.product.create({
          data: {
            id: productId,
            companyId,
            brandName: 'Depo-Provera',
            genericName: 'Medroxyprogesterone acetate',
            productCategory: 'medicinal',
            dosageForm: 'Injection',
            strength: '150mg/mL',
            isActive: true,
          },
        }),
      )

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/signals'), qppv)
        .send({ title: 'Depo-Provera cluster', description: 'Raised via the product picker', productIdentifier: 'Depo-Provera', productId })
        .expect(201)
      expect(created.body.data.productId).toBe(productId)

      const detail = await authed(request(httpServer(app)).get(`/api/v1/pv/signals/${created.body.data.id}`), qppv).expect(200)
      expect(detail.body.data.productId).toBe(productId)

      const list = await authed(request(httpServer(app)).get('/api/v1/pv/signals'), qppv).expect(200)
      const row = (list.body.data as { id: string; productId: string | null }[]).find((s) => s.id === created.body.data.id)
      expect(row?.productId).toBe(productId)
    })

    it('leaves productId null for a signal raised with a free-typed product name (no catalog match)', async () => {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/signals'), qppv)
        .send({ title: 'Cluster', description: 'Desc', productIdentifier: 'Some Unlisted Brand' })
        .expect(201)
      expect(created.body.data.productId).toBeNull()
    })

    it('links a further case via POST /:id/link-cases, idempotently', async () => {
      const caseId1 = await createCase()
      const caseId2 = await createCase()
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/signals'), qppv)
        .send({ title: 'Cluster', description: 'Desc', productIdentifier: 'Depo-Provera' })
        .expect(201)

      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/signals/${created.body.data.id}/link-cases`), qppv).send({ caseIds: [caseId1] }).expect(201)
      // Re-linking the same case plus one genuinely new one — only the new one should land.
      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/signals/${created.body.data.id}/link-cases`), qppv).send({ caseIds: [caseId1, caseId2] }).expect(201)

      const detail = await authed(request(httpServer(app)).get(`/api/v1/pv/signals/${created.body.data.id}`), qppv).expect(200)
      expect(detail.body.data.linkedCases).toHaveLength(2)
    })
  })

  describe('Lifecycle: rationale-required transitions and the documented decision history', () => {
    async function createSignal(): Promise<string> {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/signals'), qppv)
        .send({ title: 'Depo-Provera cluster', description: 'Manually raised', productIdentifier: 'Depo-Provera' })
        .expect(201)
      return created.body.data.id as string
    }

    it('blocks Detected -> Validated with no rationale note, then allows it once one is supplied', async () => {
      const signalId = await createSignal()
      const instanceId = await instanceIdFor(signalId)

      const blocked = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), qppv).send({ toStateKey: 'validated' }).expect(409)
      expect(JSON.stringify(blocked.body)).toMatch(/rationale/i)

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), qppv)
        .send({ toStateKey: 'validated', note: 'Confirmed against product information — not previously known, clinically relevant.' })
        .expect(201)

      const detail = await authed(request(httpServer(app)).get(`/api/v1/pv/signals/${signalId}`), qppv).expect(200)
      expect(detail.body.data.status).toBe('validated')
    })

    it('real-usage bug bash, 16 Aug 2026 — GET /pv/signals (the list) reflects the real transitioned status, not the creation-time default', async () => {
      const signalId = await createSignal()
      const instanceId = await instanceIdFor(signalId)

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), qppv)
        .send({ toStateKey: 'validated', note: 'Confirmed against product information — not previously known, clinically relevant.' })
        .expect(201)

      const list = await authed(request(httpServer(app)).get('/api/v1/pv/signals'), qppv).expect(200)
      const row = (list.body.data as { id: string; status: string }[]).find((s) => s.id === signalId)
      expect(row?.status).toBe('validated')
    })

    it('walks the full happy path from Detected through Assessed, capturing lifecycle data at each stage, and surfaces the decision history with rationale notes', async () => {
      const signalId = await createSignal()

      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/signals/${signalId}/validation`), qppv)
        .send({ previousAwareness: false, clinicalRelevanceNote: 'Consistent injection-site reactions across reports' })
        .expect(201)
      await transitionSignal(signalId, 'validated', 'Confirmed against product information.')

      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/signals/${signalId}/prioritisation`), qppv)
        .send({ severityNote: 'Non-serious in all reports so far', patientExposureNote: 'Two patients exposed' })
        .expect(201)
      // Confirmed here means Confirmed the pattern is real — Validated -> Confirmed.
      await transitionSignal(signalId, 'confirmed', 'Pattern reproducible across both linked cases.')
      await transitionSignal(signalId, 'analysed_prioritised', 'Severity and exposure reviewed; moderate priority.')

      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/signals/${signalId}/assessment`), qppv)
        .send({ assessmentNote: 'Consistent with a genuine, previously unlisted safety signal' })
        .expect(201)
      await transitionSignal(signalId, 'assessed', 'Assessment complete; recommending product info update.')

      const detail = await authed(request(httpServer(app)).get(`/api/v1/pv/signals/${signalId}`), qppv).expect(200)
      expect(detail.body.data.status).toBe('assessed')
      expect(detail.body.data.clinicalRelevanceNote).toBe('Consistent injection-site reactions across reports')
      expect(detail.body.data.assessmentNote).toBe('Consistent with a genuine, previously unlisted safety signal')

      const history = detail.body.data.transitionHistory as { fromStateKey: string | null; toStateKey: string; note: string | null }[]
      expect(history).toHaveLength(4)
      // AuditService.query() orders newest-first.
      expect(history.map((h) => h.toStateKey)).toEqual(['assessed', 'analysed_prioritised', 'confirmed', 'validated'])
      expect(history.every((h) => h.note && h.note.length > 0)).toBe(true)
    })

    async function transitionSignal(signalId: string, toStateKey: string, note: string): Promise<void> {
      const instanceId = await instanceIdFor(signalId)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), qppv).send({ toStateKey, note }).expect(201)
    }

    it('requires a real signature to reach the terminal Action Recommended state, and records the recommendation', async () => {
      const signalId = await createSignal()
      await transitionSignal(signalId, 'validated', 'Confirmed against product information.')
      await transitionSignal(signalId, 'confirmed', 'Pattern reproducible.')
      await transitionSignal(signalId, 'analysed_prioritised', 'Reviewed and prioritised.')
      await transitionSignal(signalId, 'assessed', 'Assessment complete.')

      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/signals/${signalId}/recommendation`), qppv)
        .send({ recommendationAction: 'propose_product_info_update', recommendationNote: 'Update the product label to reflect this reaction' })
        .expect(201)

      const instanceId = await instanceIdFor(signalId)

      // No signature token at all — the generic engine's own signature-required check (SIGNATURE_REQUIRED, a ForbiddenException) should reject this before anything else.
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), qppv)
        .send({ toStateKey: 'action_recommended', note: 'Recommending a product information update.' })
        .expect(403)

      const { SignatureTokenService } = await import('../src/modules/auth/services/signature-token.service')
      const signatureTokenService = app.get(SignatureTokenService)
      const signatureToken = await signatureTokenService.issue(qppv.userId)

      const signed = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), qppv)
        .send({ toStateKey: 'action_recommended', signatureToken, intentStatement: 'I recommend this action based on my assessment', note: 'Recommending a product information update.' })
        .expect(201)
      expect(signed.body.data.id).toBe(instanceId)

      const detail = await authed(request(httpServer(app)).get(`/api/v1/pv/signals/${signalId}`), qppv).expect(200)
      expect(detail.body.data.status).toBe('action_recommended')
      expect(detail.body.data.recommendationAction).toBe('propose_product_info_update')
    })

    it('supports the Refuted branch from Assessed with no signature required', async () => {
      const signalId = await createSignal()
      await transitionSignal(signalId, 'validated', 'Confirmed.')
      await transitionSignal(signalId, 'confirmed', 'Reproducible.')
      await transitionSignal(signalId, 'analysed_prioritised', 'Prioritised.')
      await transitionSignal(signalId, 'assessed', 'Assessed.')
      await transitionSignal(signalId, 'refuted', 'On review, the cases share no real causal link — coincidental co-reporting.')

      const detail = await authed(request(httpServer(app)).get(`/api/v1/pv/signals/${signalId}`), qppv).expect(200)
      expect(detail.body.data.status).toBe('refuted')
    })

    it('supports the early Not Confirmed rejection branch from Validated', async () => {
      const signalId = await createSignal()
      await transitionSignal(signalId, 'validated', 'Confirmed against product information.')
      await transitionSignal(signalId, 'not_confirmed', 'Single-source artifact, not reproducible on closer review.')

      const detail = await authed(request(httpServer(app)).get(`/api/v1/pv/signals/${signalId}`), qppv).expect(200)
      expect(detail.body.data.status).toBe('not_confirmed')
    })
  })

  describe('Permissions', () => {
    it('rejects signal creation and mutation without pv.manage_signals', async () => {
      await authedWrite(request(httpServer(app)).post('/api/v1/pv/signals'), viewOnlyActor)
        .send({ title: 'x', description: 'y', productIdentifier: 'z' })
        .expect(403)
    })

    it('rejects reading signals with neither pv.manage_signals nor pv.view_all', async () => {
      await authed(request(httpServer(app)).get('/api/v1/pv/signals'), noPermActor).expect(403)
    })

    it('allows a pv.view_all actor to read signals without being able to create them', async () => {
      await authedWrite(request(httpServer(app)).post('/api/v1/pv/signals'), qppv).send({ title: 'x', description: 'y', productIdentifier: 'z' }).expect(201)

      await authed(request(httpServer(app)).get('/api/v1/pv/signals'), viewOnlyActor).expect(200)
      await authedWrite(request(httpServer(app)).post('/api/v1/pv/signals'), viewOnlyActor).send({ title: 'x', description: 'y', productIdentifier: 'z' }).expect(403)
    })
  })
})
