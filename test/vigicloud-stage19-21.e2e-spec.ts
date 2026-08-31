import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

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

function withBypass<T>(fn: (tx: typeof testPrisma) => Promise<T>): Promise<T> {
  return testPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
    return fn(tx as unknown as typeof testPrisma)
  })
}

/**
 * VigiCloud Stage 19 (Literature Monitoring + Global Molecule
 * Intelligence) + Stage 21 (Voicemail / Missed-Call Logging).
 */
describe('VigiCloud Stage 19/21 (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string
  let reportTypeId: string

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
    await testPrisma.company.create({ data: { id: companyId, name: 'Stage19-21 Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })
    reportTypeId = randomUUID()
    await testPrisma.reportType.create({ data: { id: reportTypeId, typeKey: `adr_e2e_${randomUUID()}`, name: 'Suspected ADR' } })

    // Minimal re-derivation of the real seeded `pv_case` workflow — the dev
    // seed never runs against the truncated-per-test e2e database, and
    // `WorkflowService.instantiate()` (called internally by `POST /pv/cases`)
    // needs at least an initial state to instantiate against.
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
  })

  async function actorWith(roleKey: string, permissions: string[]): Promise<TestActor> {
    await seedRoleWithPermissions(roleKey, permissions)
    return createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [roleKey] })
  }

  describe('Stage 19 — Literature Monitoring', () => {
    it('logs a run, lists it back, and audits the action', async () => {
      const actor = await actorWith('QPPV', ['pv.manage_literature_monitoring'])

      const logged = await authedWrite(request(httpServer(app)).post('/api/v1/literature-monitoring-runs'), actor)
        .send({ runAt: '2026-08-10', method: 'PubMed manual search', searchTerms: 'paracetamol AND hepatotoxicity', hitsCount: 2, hitsSummary: 'No new signals.' })
        .expect(201)
      expect(logged.body.data.method).toBe('PubMed manual search')

      const list = await authed(request(httpServer(app)).get('/api/v1/literature-monitoring-runs'), actor).expect(200)
      expect(list.body.data).toHaveLength(1)
      expect(list.body.data[0].hitsCount).toBe(2)

      const auditEntries = await testPrisma.auditEntry.findMany({ where: { companyId, action: 'literature_monitoring_run_logged' } })
      expect(auditEntries).toHaveLength(1)
    })

    it('401s unauthenticated, 403s an actor without pv.manage_literature_monitoring', async () => {
      const actor = await actorWith('DISPENSING_PHARMACIST', ['pv.capture_case'])
      await request(httpServer(app)).post('/api/v1/literature-monitoring-runs').send({ runAt: '2026-08-10', method: 'x', searchTerms: 'y', hitsCount: 0 }).expect(401)
      await authedWrite(request(httpServer(app)).post('/api/v1/literature-monitoring-runs'), actor)
        .send({ runAt: '2026-08-10', method: 'x', searchTerms: 'y', hitsCount: 0 })
        .expect(403)
    })

    it('the audit-readiness literature_monitoring row goes from missing to ready once a run is logged', async () => {
      const actor = await actorWith('QPPV', ['pv.manage_literature_monitoring', 'governance.view'])
      await seedRoleWithPermissions('QPPV', ['pv.manage_literature_monitoring', 'governance.view'])

      const authority = await withBypass((tx) => tx.regulatoryAuthority.upsert({ where: { countryId_code: { countryId, code: 'PPB' } }, update: {}, create: { id: randomUUID(), countryId, code: 'PPB', name: 'Pharmacy and Poisons Board' } }))
      await withBypass((tx) =>
        tx.auditRequirementDefinition.create({
          data: { id: randomUUID(), authorityId: authority.id, requirementKey: 'literature_monitoring', sortOrder: 12, title: 'Literature-monitoring evidence', description: 'x', source: 'system_generated', evidenceArtifactType: 'x', isMandatory: true, active: true },
        }),
      )

      const before = await authed(request(httpServer(app)).get('/api/v1/governance/audit-readiness'), actor).expect(200)
      expect(before.body.data.rows[0].status).toBe('missing')

      await authedWrite(request(httpServer(app)).post('/api/v1/literature-monitoring-runs'), actor)
        .send({ runAt: new Date().toISOString().slice(0, 10), method: 'PubMed manual search', searchTerms: 'x', hitsCount: 1 })
        .expect(201)

      const after = await authed(request(httpServer(app)).get('/api/v1/governance/audit-readiness'), actor).expect(200)
      expect(after.body.data.rows[0].status).toBe('ready')
    })
  })

  describe('Stage 19 — Global Molecule Intelligence', () => {
    async function createCaseForMolecule(actor: TestActor, activeSubstanceName: string, seriousnessClass?: string) {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor)
        .send({
          reportTypeId,
          countryOfOccurrenceId: countryId,
          countryOfReportId: countryId,
          awarenessDate: '2026-08-01',
          receivedDate: '2026-08-01',
          reporter: { reporterType: 'consumer', fullName: 'Jane Doe' },
          patient: { ageYears: 40 },
          suspectProducts: [{ drugCharacterization: 'suspect', medicinalProduct: 'Panadol', activeSubstanceName }],
          adverseEvents: [{ reportedTerm: 'Rash', narrative: 'Developed a rash' }],
        })
        .expect(201)
      const caseId = created.body.data.id as string
      if (seriousnessClass) {
        await withBypass((tx) => tx.case.update({ where: { id: caseId }, data: { seriousnessClass } }))
      }
      return caseId
    }

    it('lists own molecules and returns an own-tenant aggregate for a queried one', async () => {
      const actor = await actorWith('QPPV', ['pv.capture_case', 'pv.view_molecule_intelligence'])
      await createCaseForMolecule(actor, 'PARACETAMOL', 'serious')
      await createCaseForMolecule(actor, 'PARACETAMOL', 'non_serious')
      await createCaseForMolecule(actor, 'AMOXICILLIN')

      const molecules = await authed(request(httpServer(app)).get('/api/v1/pv/molecule-intelligence/molecules'), actor).expect(200)
      expect(molecules.body.data).toEqual(expect.arrayContaining(['PARACETAMOL', 'AMOXICILLIN']))

      const view = await authed(request(httpServer(app)).get('/api/v1/pv/molecule-intelligence/paracetamol'), actor).expect(200)
      expect(view.body.data.own.totalCases).toBe(2)
      expect(view.body.data.own.bySeriousness).toEqual(expect.arrayContaining([{ seriousnessClass: 'serious', caseCount: 1 }, { seriousnessClass: 'non_serious', caseCount: 1 }]))
    })

    // testing-todo 19.1 — the cross-portfolio aggregate (a previously
    // count-only, anonymized view of *other* tenants' cases for the same
    // molecule) was deliberately removed 17 Aug 2026: a product decision
    // that any cross-company statistic shown to a tenant, even count-only,
    // is not acceptable — a risk to client trust. This test proves the
    // removal at the real HTTP layer: a second tenant's real case for the
    // same molecule exists, but nothing about it (not even a bare count)
    // reaches the querying tenant's response.
    it('a second tenant\'s case for the same molecule never appears in this tenant\'s view, in any form', async () => {
      const actor = await actorWith('QPPV', ['pv.capture_case', 'pv.view_molecule_intelligence'])
      await createCaseForMolecule(actor, 'PARACETAMOL')

      const otherCountryId = randomUUID()
      await testPrisma.country.create({ data: { id: otherCountryId, isoCode: 'UG', name: 'Uganda' } })
      const otherCompanyId = randomUUID()
      await testPrisma.company.create({ data: { id: otherCompanyId, name: 'Other Tenant Co', companyType: 'manufacturer', homeCountryId: otherCountryId, status: 'active' } })
      const otherReportTypeId = randomUUID()
      await testPrisma.reportType.create({ data: { id: otherReportTypeId, typeKey: `adr_other_${randomUUID()}`, name: 'Suspected ADR' } })
      const otherActor = await createAuthenticatedActor(app, testPrisma, { companyId: otherCompanyId, roleKeys: ['QPPV'] })
      await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), otherActor)
        .send({
          reportTypeId: otherReportTypeId,
          countryOfOccurrenceId: otherCountryId,
          countryOfReportId: otherCountryId,
          awarenessDate: '2026-08-01',
          receivedDate: '2026-08-01',
          reporter: { reporterType: 'consumer', fullName: 'John Doe' },
          patient: { ageYears: 30 },
          suspectProducts: [{ drugCharacterization: 'suspect', medicinalProduct: 'Generic Panadol', activeSubstanceName: 'PARACETAMOL' }],
          adverseEvents: [{ reportedTerm: 'Nausea', narrative: 'Felt nauseous' }],
        })
        .expect(201)

      const view = await authed(request(httpServer(app)).get('/api/v1/pv/molecule-intelligence/PARACETAMOL'), actor).expect(200)
      expect(Object.keys(view.body.data as Record<string, unknown>)).toEqual(['moleculeName', 'own'])
      expect(view.body.data.own.totalCases).toBe(1)
      expect(JSON.stringify(view.body.data)).not.toMatch(/crossPortfolio|otherTenant|contributingTenant/)
      expect(JSON.stringify(view.body.data)).not.toMatch(new RegExp(otherCompanyId))

      const ownSideAudit = await testPrisma.auditEntry.findMany({ where: { companyId, action: 'molecule_intelligence_queried' } })
      expect(ownSideAudit).toHaveLength(1)
    })

    it('401s unauthenticated, 403s an actor without pv.view_molecule_intelligence', async () => {
      const actor = await actorWith('DISPENSING_PHARMACIST', ['pv.capture_case'])
      await request(httpServer(app)).get('/api/v1/pv/molecule-intelligence/molecules').expect(401)
      await authed(request(httpServer(app)).get('/api/v1/pv/molecule-intelligence/molecules'), actor).expect(403)
    })
  })

  describe('Stage 21 — Voicemail / Missed-Call Logging', () => {
    it('logs a voicemail with an encrypted transcription note, returned decrypted, and the after-hours flag computed correctly', async () => {
      const actor = await actorWith('DISPENSING_PHARMACIST', ['pv.capture_case'])

      const documentId = randomUUID()
      await withBypass((tx) => tx.document.create({ data: { id: documentId, companyId, recordType: 'pv_call_log', recordId: 'n/a', title: 'Voicemail audio', createdBy: actor.userId } }))

      const logged = await authedWrite(request(httpServer(app)).post('/api/v1/pv/call-logs'), actor)
        .send({
          callerNumber: '+254700000099',
          occurredAt: '2026-08-08T20:00:00.000Z', // Saturday evening — after hours
          outcome: 'unable_to_reach',
          isVoicemail: true,
          audioDocumentId: documentId,
          transcriptionNote: 'Caller reported a rash after taking Panadol, please call back.',
        })
        .expect(201)

      expect(logged.body.data.isVoicemail).toBe(true)
      expect(logged.body.data.isAfterHours).toBe(true)
      expect(logged.body.data.transcriptionNote).toBe('Caller reported a rash after taking Panadol, please call back.')
      expect(logged.body.data.transcriptionNoteEncrypted).toBeUndefined()

      const rawRow = await withBypass((tx) => tx.callLog.findUniqueOrThrow({ where: { id: logged.body.data.id } }))
      expect(rawRow.transcriptionNoteEncrypted).not.toContain('Caller reported a rash')
      expect(rawRow.audioDocumentId).toBe(documentId)
    })

    it('404s when audioDocumentId does not belong to this company', async () => {
      const actor = await actorWith('DISPENSING_PHARMACIST', ['pv.capture_case'])
      const res = await authedWrite(request(httpServer(app)).post('/api/v1/pv/call-logs'), actor)
        .send({ callerNumber: '+254700000099', occurredAt: '2026-08-08T20:00:00.000Z', outcome: 'unable_to_reach', isVoicemail: true, audioDocumentId: randomUUID() })
        .expect(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })

    it('a real after-hours voicemail log satisfies the audit-readiness 24/7-availability evidence row', async () => {
      const actor = await actorWith('DISPENSING_PHARMACIST', ['pv.capture_case'])
      await seedRoleWithPermissions('QUALITY_ASSOCIATE', ['governance.view'])
      const viewerActor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['QUALITY_ASSOCIATE'] })

      const authority = await withBypass((tx) => tx.regulatoryAuthority.upsert({ where: { countryId_code: { countryId, code: 'PPB' } }, update: {}, create: { id: randomUUID(), countryId, code: 'PPB', name: 'Pharmacy and Poisons Board' } }))
      await withBypass((tx) =>
        tx.auditRequirementDefinition.create({
          data: { id: randomUUID(), authorityId: authority.id, requirementKey: 'availability_evidence', sortOrder: 7, title: '24/7 availability', description: 'x', source: 'system_generated', evidenceArtifactType: 'x', isMandatory: true, active: true },
        }),
      )

      const before = await authed(request(httpServer(app)).get('/api/v1/governance/audit-readiness'), viewerActor).expect(200)
      expect(before.body.data.rows[0].status).toBe('missing')

      await authedWrite(request(httpServer(app)).post('/api/v1/pv/call-logs'), actor)
        .send({ callerNumber: '+254700000099', occurredAt: new Date('2026-08-08T20:00:00.000Z').toISOString(), outcome: 'information_only', isVoicemail: true })
        .expect(201)

      const after = await authed(request(httpServer(app)).get('/api/v1/governance/audit-readiness'), viewerActor).expect(200)
      expect(after.body.data.rows[0].status).toBe('ready')
    })
  })
})
