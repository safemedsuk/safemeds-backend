import { INestApplication } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import request from 'supertest'

import { StorageService } from '../src/modules/documents/storage.service'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

/** Same in-memory stand-in `admin-config-console.e2e-spec.ts` uses — real R2 hits the known Jest/TLS gotcha (CLAUDE.md), unrelated to anything this spec tests. */
class FakeStorageService {
  putObject(key: string, body: Buffer): Promise<{ key: string; sha256: string; sizeBytes: number }> {
    return Promise.resolve({ key, sha256: createHash('sha256').update(body).digest('hex'), sizeBytes: body.byteLength })
  }
}

/**
 * RegCloud (Phase 12) Stage 0 — Foundation: the country rule-set graph
 * (0.1), the entity/hierarchy model (0.2), dossier assembly (0.3), the
 * renewal deadline engine (0.4), the fees ledger (0.5), and cross-module
 * location-scope composition (0.6), all exercised end-to-end against the
 * real running app — mirroring `test/country-config.e2e-spec.ts`'s own
 * version-on-write walkthrough and `test/master-data.e2e-spec.ts`'s own
 * tenant-fixture shape.
 */
describe('RegCloud Stage 0 — Foundation (e2e)', () => {
  let app: INestApplication
  let admin: TestActor
  let raOfficer: TestActor
  let sysAdmin: TestActor
  let countryId: string
  let authorityId: string
  let companyId: string
  let productId: string

  beforeAll(async () => {
    app = await createTestApp((builder) => builder.overrideProvider(StorageService).useValue(new FakeStorageService()))
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

  beforeEach(async () => {
    countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    authorityId = randomUUID()
    await testPrisma.regulatoryAuthority.create({ data: { id: authorityId, countryId, code: 'PPB', name: 'Pharmacy and Poisons Board' } })

    companyId = randomUUID()
    await testPrisma.company.create({
      data: { id: companyId, name: 'RegCloud Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' },
    })

    // Platform-side: `super_admin` → `platform.config.manage`, the same
    // permission every other Admin Configuration Console gap already
    // reuses — see `RegConfigController`'s own doc comment for why this
    // spec doesn't seed a new permission.
    const platformRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: platformRoleId, key: 'super_admin', name: 'Platform Super Admin', description: 'test fixture', isPlatform: true } })
    const platformPermissionId = randomUUID()
    await testPrisma.permission.create({ data: { id: platformPermissionId, key: 'platform.config.manage', description: 'test fixture' } })
    await testPrisma.rolePermission.create({ data: { roleId: platformRoleId, permissionId: platformPermissionId } })
    admin = await createAuthenticatedActor(app, testPrisma, { platformRole: 'super_admin' })

    // Tenant-side: `REGULATORY_AFFAIRS_OFFICER` → the full RegCloud Stage 0
    // tenant permission set, plus the pre-existing `master_data.*` (for the
    // ProductRegistration → RegDeadline wiring test).
    const tenantRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: tenantRoleId, key: 'REGULATORY_AFFAIRS_OFFICER', name: 'RA Officer', description: 'test fixture', isPlatform: false } })
    for (const key of [
      'regulatory.manage_entities',
      'regulatory.manage_dossier',
      'regulatory.manage_fees',
      'regulatory.view_all',
      'master_data.manage',
      'master_data.view',
      'documents.manage',
    ]) {
      const permissionId = randomUUID()
      await testPrisma.permission.create({ data: { id: permissionId, key, description: 'test fixture' } })
      await testPrisma.rolePermission.create({ data: { roleId: tenantRoleId, permissionId } })
    }
    raOfficer = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['REGULATORY_AFFAIRS_OFFICER'] })

    // Minimal re-derivation of the real seeded `reg_registration` workflow
    // (Stage 1) — same reasoning as `pv-case.e2e-spec.ts`'s own doc
    // comment: the dev seed never runs against this truncated-per-test
    // database, and `RegDossierService.create()` now instantiates a real
    // workflow on every dossier, so every test in this file that calls
    // `POST /reg-dossiers` needs one to exist.
    const regDefinitionId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: regDefinitionId, recordType: 'reg_registration', reportTypeId: null, countryId: null, version: 1, status: 'active' } })
    const planningStateId = randomUUID()
    const compilingStateId = randomUUID()
    const completenessCheckStateId = randomUUID()
    await testPrisma.workflowState.createMany({
      data: [
        { id: planningStateId, definitionId: regDefinitionId, stateKey: 'planning', name: 'Planning', isInitial: true, isTerminal: false },
        { id: compilingStateId, definitionId: regDefinitionId, stateKey: 'compiling', name: 'Compiling Dossier', isInitial: false, isTerminal: false },
        { id: completenessCheckStateId, definitionId: regDefinitionId, stateKey: 'completeness_check', name: 'Completeness Check', isInitial: false, isTerminal: true },
      ],
    })
    await testPrisma.workflowTransition.createMany({
      data: [
        { id: randomUUID(), definitionId: regDefinitionId, fromStateId: planningStateId, toStateId: compilingStateId, requiredRoleId: tenantRoleId, requiresSignature: false },
        { id: randomUUID(), definitionId: regDefinitionId, fromStateId: compilingStateId, toStateId: completenessCheckStateId, requiredRoleId: tenantRoleId, requiresSignature: false },
      ],
    })

    // A real `SYSTEM_ADMINISTRATOR` fixture — 0.6's location-scope grant
    // endpoint requires `users.manage_roles`, which `REGULATORY_AFFAIRS_OFFICER`
    // deliberately doesn't hold; a tenant admin granting a scope to someone
    // else is the realistic shape, not an RA officer granting themselves one.
    const sysAdminRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: sysAdminRoleId, key: 'SYSTEM_ADMINISTRATOR', name: 'System Administrator', description: 'test fixture', isPlatform: false } })
    const usersManageRolesPermissionId = randomUUID()
    await testPrisma.permission.create({ data: { id: usersManageRolesPermissionId, key: 'users.manage_roles', description: 'test fixture' } })
    await testPrisma.rolePermission.create({ data: { roleId: sysAdminRoleId, permissionId: usersManageRolesPermissionId } })
    sysAdmin = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['SYSTEM_ADMINISTRATOR'] })

    // `product` has RLS forced (Phase 7) — created through the real API,
    // not a raw `testPrisma.product.create()`, exactly like
    // `master-data.e2e-spec.ts`'s own precedent.
    const product = await authedWrite(request(httpServer(app)).post('/api/v1/products'), raOfficer)
      .send({ brandName: 'Amoxiclav', genericName: 'Amoxicillin/Clavulanate', productCategory: 'medicinal', dosageForm: 'tablet', strength: '500mg' })
      .expect(201)
    productId = product.body.data.id as string
  })

  describe('0.1 — country rule-set graph', () => {
    it('a regulatory requirement walks draft → unverified-blocked → activated, with its document checklist, and resolves', async () => {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/regulatory-config/requirements'), admin)
        .send({
          countryId,
          authorityId,
          productClass: 'generic_pharma',
          effectiveFrom: '2026-01-01',
          documentDefinitions: [
            { documentKey: 'cpp', name: 'Certificate of Pharmaceutical Product', ctdModule: 'Module 1' },
            { documentKey: 'gmp_certificate', name: 'GMP Certificate', ctdModule: 'Module 1' },
          ],
        })
        .expect(201)
      expect(created.body.data).toMatchObject({ version: 1, status: 'draft', unverified: true, route: '*' })
      expect(created.body.data.documentDefinitions).toHaveLength(2)
      const requirementId = created.body.data.id as string

      // Still unverified by default — activation must be refused with a real, typed reason.
      await authedWrite(request(httpServer(app)).post(`/api/v1/regulatory-config/requirements/${requirementId}/activate`), admin).expect(400)

      // No draft flag exists to flip in place (version-on-write, no PATCH) —
      // create a second, explicitly-verified version and activate that one.
      const verified = await authedWrite(request(httpServer(app)).post('/api/v1/regulatory-config/requirements'), admin)
        .send({
          countryId,
          authorityId,
          productClass: 'generic_pharma',
          effectiveFrom: '2026-01-01',
          unverified: false,
          sourceReference: 'e2e-confirmed',
          documentDefinitions: [{ documentKey: 'cpp', name: 'Certificate of Pharmaceutical Product' }],
        })
        .expect(201)
      expect(verified.body.data.version).toBe(2)
      const verifiedId = verified.body.data.id as string

      await authedWrite(request(httpServer(app)).post(`/api/v1/regulatory-config/requirements/${verifiedId}/activate`), admin).expect(201)

      const resolved = await authed(
        request(httpServer(app)).get(`/api/v1/regulatory-config/requirements/resolve?countryId=${countryId}&authorityId=${authorityId}&productClass=generic_pharma`),
        raOfficer,
      ).expect(200)
      expect(resolved.body.data).toMatchObject({ id: verifiedId, status: 'active', sourceReference: 'e2e-confirmed' })
    })

    it('resolve falls back to the "*" route sentinel when nothing route-specific is active', async () => {
      const draft = await authedWrite(request(httpServer(app)).post('/api/v1/regulatory-config/requirements'), admin)
        .send({ countryId, authorityId, productClass: 'generic_pharma', effectiveFrom: '2026-01-01', unverified: false })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/regulatory-config/requirements/${draft.body.data.id}/activate`), admin).expect(201)

      const resolvedForOral = await authed(
        request(httpServer(app)).get(`/api/v1/regulatory-config/requirements/resolve?countryId=${countryId}&authorityId=${authorityId}&productClass=generic_pharma&route=oral`),
        raOfficer,
      ).expect(200)
      expect(resolvedForOral.body.data.id).toBe(draft.body.data.id)
    })

    it('a fee schedule resolves route-specific over wildcard for the same fee type', async () => {
      const wildcard = await authedWrite(request(httpServer(app)).post('/api/v1/regulatory-config/fee-schedules'), admin)
        .send({ countryId, authorityId, productClass: 'generic_pharma', feeType: 'application', amount: '5000.00', unverified: false, effectiveFrom: '2026-01-01' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/regulatory-config/fee-schedules/${wildcard.body.data.id}/activate`), admin).expect(201)

      const oralSpecific = await authedWrite(request(httpServer(app)).post('/api/v1/regulatory-config/fee-schedules'), admin)
        .send({ countryId, authorityId, productClass: 'generic_pharma', route: 'oral', feeType: 'application', amount: '4500.00', unverified: false, effectiveFrom: '2026-01-01' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/regulatory-config/fee-schedules/${oralSpecific.body.data.id}/activate`), admin).expect(201)

      const resolved = await authed(
        request(httpServer(app)).get(`/api/v1/regulatory-config/fee-schedules/resolve?countryId=${countryId}&authorityId=${authorityId}&productClass=generic_pharma&route=oral`),
        raOfficer,
      ).expect(200)
      expect(resolved.body.data).toEqual([expect.objectContaining({ amount: '4500', route: 'oral' })])
    })

    it('a deadline rule defaults productClass to the "*" sentinel and activates', async () => {
      const rule = await authedWrite(request(httpServer(app)).post('/api/v1/regulatory-config/deadline-rules'), admin)
        .send({ countryId, authorityId, obligationType: 'renewal', intervalValue: 5, intervalUnit: 'years', unverified: false, effectiveFrom: '2026-01-01' })
        .expect(201)
      expect(rule.body.data.productClass).toBe('*')

      await authedWrite(request(httpServer(app)).post(`/api/v1/regulatory-config/deadline-rules/${rule.body.data.id}/activate`), admin).expect(201)

      const list = await authed(request(httpServer(app)).get(`/api/v1/regulatory-config/deadline-rules?countryId=${countryId}`), raOfficer).expect(200)
      expect(list.body.data).toEqual([expect.objectContaining({ id: rule.body.data.id, status: 'active' })])
    })
  })

  describe('0.2 — regulatory entity & hierarchy model', () => {
    it('creates a manufacturer, a manufacturing site under it, and a local representative — all tenant-scoped', async () => {
      const manufacturer = await authedWrite(request(httpServer(app)).post('/api/v1/manufacturers'), raOfficer)
        .send({ name: 'Global Pharma Manufacturing', countryId })
        .expect(201)
      const manufacturerId = manufacturer.body.data.id as string

      const site = await authedWrite(request(httpServer(app)).post('/api/v1/manufacturing-sites'), raOfficer)
        .send({ manufacturerId, siteName: 'Plant 1', gmpCertificateNumber: 'GMP-2026-001', gmpCertificateExpiresOn: '2028-01-01' })
        .expect(201)
      expect(site.body.data).toMatchObject({ manufacturerId, siteName: 'Plant 1' })

      const localRep = await authedWrite(request(httpServer(app)).post('/api/v1/local-representatives'), raOfficer)
        .send({ name: 'Nairobi Regulatory Services Ltd', contactEmail: 'ops@nrsl.co.ke' })
        .expect(201)
      expect(localRep.body.data.name).toBe('Nairobi Regulatory Services Ltd')

      const list = await authed(request(httpServer(app)).get('/api/v1/manufacturers'), raOfficer).expect(200)
      const listRows = list.body.data as { id: string }[]
      expect(listRows.map((m) => m.id)).toContain(manufacturerId)
    })
  })

  describe('0.3 — document custody & dossier assembly', () => {
    it('creating a dossier pre-populates one slot per checklist item from the active resolved requirement, then a document can be attached and detached', async () => {
      const req = await authedWrite(request(httpServer(app)).post('/api/v1/regulatory-config/requirements'), admin)
        .send({
          countryId,
          authorityId,
          productClass: 'generic_pharma',
          effectiveFrom: '2026-01-01',
          unverified: false,
          documentDefinitions: [
            { documentKey: 'cpp', name: 'Certificate of Pharmaceutical Product' },
            { documentKey: 'gmp_certificate', name: 'GMP Certificate' },
          ],
        })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/regulatory-config/requirements/${req.body.data.id}/activate`), admin).expect(201)

      const dossier = await authedWrite(request(httpServer(app)).post('/api/v1/reg-dossiers'), raOfficer)
        .send({ productId, authorityId, productClass: 'generic_pharma' })
        .expect(201)
      expect(dossier.body.data.documentSlots).toHaveLength(2)
      const slotId = dossier.body.data.documentSlots[0].id as string
      const dossierId = dossier.body.data.id as string

      // A real `Document` row via the actual server-proxied upload path
      // (`documents-upload.e2e-spec.ts`'s own precedent) — this spec is
      // about the dossier/slot attach-detach mechanics, not the upload
      // pipeline itself, but `document` carries RLS so it needs a real
      // request, not a raw `testPrisma.document.create()`.
      const uploadRes = await authedWrite(request(httpServer(app)).post(`/api/v1/records/reg_dossier/${dossierId}/documents/upload`), raOfficer)
        .field('title', 'CPP scan')
        .attach('file', Buffer.from('%PDF-1.4 fake cpp scan'), { filename: 'cpp.pdf', contentType: 'application/pdf' })
        .expect(201)
      const documentId = uploadRes.body.data.document.id as string

      const attached = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/slots/${slotId}/attach`), raOfficer)
        .send({ documentId })
        .expect(201)
      expect(attached.body.data.documentId).toBe(documentId)

      const detached = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/slots/${slotId}/detach`), raOfficer).expect(201)
      expect(detached.body.data.documentId).toBeNull()
    })

    it('creates a dossier with zero slots when nothing resolves for the given class — never blocks on an unconfigured market', async () => {
      const dossier = await authedWrite(request(httpServer(app)).post('/api/v1/reg-dossiers'), raOfficer)
        .send({ productId, authorityId, productClass: 'unconfigured_class' })
        .expect(201)
      expect(dossier.body.data.documentSlots).toEqual([])
    })
  })

  describe('0.4 — renewal & variation deadline engine', () => {
    it('creating a ProductRegistration in a market with an active renewal rule computes a real RegDeadline using calendar-year arithmetic', async () => {
      const rule = await authedWrite(request(httpServer(app)).post('/api/v1/regulatory-config/deadline-rules'), admin)
        .send({ countryId, authorityId, obligationType: 'renewal', intervalValue: 5, intervalUnit: 'years', unverified: false, effectiveFrom: '2026-01-01' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/regulatory-config/deadline-rules/${rule.body.data.id}/activate`), admin).expect(201)

      const registration = await authedWrite(request(httpServer(app)).post('/api/v1/registrations'), raOfficer)
        .send({ productId, authorityId, registrationNumber: 'PPB-2026-0001', issuedOn: '2026-03-01', expiresOn: '2026-04-01', productClass: 'generic_pharma' })
        .expect(201)

      const deadlines = await authed(request(httpServer(app)).get('/api/v1/reg-deadlines'), raOfficer).expect(200)
      expect(deadlines.body.data).toEqual([
        expect.objectContaining({ recordType: 'reg_registration_renewal', recordId: registration.body.data.id, status: 'pending' }),
      ])
      // 1 Mar 2026 + 5 years = 1 Mar 2031, real calendar arithmetic — not
      // whatever `expiresOn` (1 Apr 2026) was separately, manually typed in.
      const deadlineRows = deadlines.body.data as { dueAt: string }[]
      expect(deadlineRows[0].dueAt.slice(0, 10)).toBe('2031-03-01')
    })

    it('creating a ProductRegistration in an unconfigured market succeeds with no RegDeadline at all — graceful degradation, never a blocked create', async () => {
      const otherAuthorityId = randomUUID()
      await testPrisma.regulatoryAuthority.create({ data: { id: otherAuthorityId, countryId, code: 'OTHER', name: 'Unconfigured Authority' } })

      await authedWrite(request(httpServer(app)).post('/api/v1/registrations'), raOfficer)
        .send({ productId, authorityId: otherAuthorityId, registrationNumber: 'OTHER-0001', issuedOn: '2026-03-01', expiresOn: '2027-03-01' })
        .expect(201)

      const deadlines = await authed(request(httpServer(app)).get('/api/v1/reg-deadlines'), raOfficer).expect(200)
      expect(deadlines.body.data).toEqual([])
    })
  })

  describe('0.5 — fees ledger', () => {
    it('manually creates an invoice, records a partial then a completing payment, and it flips to paid only once fully covered', async () => {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/reg-fee-invoices'), raOfficer)
        .send({ feeType: 'application', amount: '5000.00', dueAt: '2026-12-01' })
        .expect(201)
      expect(created.body.data.status).toBe('pending')
      const invoiceId = created.body.data.id as string

      const afterPartial = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-fee-invoices/${invoiceId}/payments`), raOfficer)
        .send({ amount: '2000.00', paidAt: '2026-06-01' })
        .expect(201)
      expect(afterPartial.body.data.status).toBe('pending')

      const afterFull = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-fee-invoices/${invoiceId}/payments`), raOfficer)
        .send({ amount: '3000.00', paidAt: '2026-06-15' })
        .expect(201)
      expect(afterFull.body.data.status).toBe('paid')
      expect(afterFull.body.data.payments).toHaveLength(2)
    })

    it('waiving an invoice sets its status to waived, never deleted', async () => {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/reg-fee-invoices'), raOfficer)
        .send({ feeType: 'renewal', amount: '1000.00', dueAt: '2026-12-01' })
        .expect(201)

      const waived = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-fee-invoices/${created.body.data.id}/waive`), raOfficer).expect(201)
      expect(waived.body.data.status).toBe('waived')

      const stillThere = await authed(request(httpServer(app)).get(`/api/v1/reg-fee-invoices/${created.body.data.id}`), raOfficer).expect(200)
      expect(stillThere.body.data.status).toBe('waived')
    })

    it('creating a registration with an active application fee schedule auto-generates a real pending invoice for it', async () => {
      const fee = await authedWrite(request(httpServer(app)).post('/api/v1/regulatory-config/fee-schedules'), admin)
        .send({ countryId, authorityId, productClass: 'generic_pharma', feeType: 'application', amount: '7500.00', unverified: false, effectiveFrom: '2026-01-01' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/regulatory-config/fee-schedules/${fee.body.data.id}/activate`), admin).expect(201)

      const registration = await authedWrite(request(httpServer(app)).post('/api/v1/registrations'), raOfficer)
        .send({ productId, authorityId, registrationNumber: 'PPB-2026-0777', issuedOn: '2026-03-01', expiresOn: '2027-03-01', productClass: 'generic_pharma' })
        .expect(201)

      const invoices = await authed(
        request(httpServer(app)).get(`/api/v1/reg-fee-invoices?productRegistrationId=${registration.body.data.id}`),
        raOfficer,
      ).expect(200)
      expect(invoices.body.data).toEqual([
        expect.objectContaining({ feeType: 'application', amount: '7500', currency: 'KES', status: 'pending', regulatoryFeeScheduleId: fee.body.data.id }),
      ])
    })
  })

  describe('0.6 — cross-module joins & access scoping', () => {
    it('a market-scoped RA officer only sees registrations and dossiers under an authority in their granted country', async () => {
      // A second, unrelated country/authority the scoped officer is never granted.
      const otherCountryId = randomUUID()
      await testPrisma.country.create({ data: { id: otherCountryId, isoCode: 'UG', name: 'Uganda' } })
      const otherAuthorityId = randomUUID()
      await testPrisma.regulatoryAuthority.create({ data: { id: otherAuthorityId, countryId: otherCountryId, code: 'NDA', name: 'National Drug Authority' } })

      const inScope = await authedWrite(request(httpServer(app)).post('/api/v1/registrations'), raOfficer)
        .send({ productId, authorityId, registrationNumber: 'IN-SCOPE-0001', issuedOn: '2026-01-01', expiresOn: '2027-01-01' })
        .expect(201)
      const outOfScope = await authedWrite(request(httpServer(app)).post('/api/v1/registrations'), raOfficer)
        .send({ productId, authorityId: otherAuthorityId, registrationNumber: 'OUT-OF-SCOPE-0001', issuedOn: '2026-01-01', expiresOn: '2027-01-01' })
        .expect(201)

      // Grant a real market-level scope for Kenya only, via the actual API.
      await authedWrite(request(httpServer(app)).post(`/api/v1/users/${raOfficer.userId}/location-scopes`), sysAdmin)
        .send({ level: 'market', countryId })
        .expect(201)

      const registrations = await authed(request(httpServer(app)).get('/api/v1/registrations'), raOfficer).expect(200)
      const registrationIds = (registrations.body.data as { id: string }[]).map((r) => r.id)
      expect(registrationIds).toContain(inScope.body.data.id)
      expect(registrationIds).not.toContain(outOfScope.body.data.id)

      const dossierInScope = await authedWrite(request(httpServer(app)).post('/api/v1/reg-dossiers'), raOfficer)
        .send({ productId, authorityId, productClass: 'generic_pharma' })
        .expect(201)
      const dossiers = await authed(request(httpServer(app)).get('/api/v1/reg-dossiers'), raOfficer).expect(200)
      expect((dossiers.body.data as { id: string }[]).map((d) => d.id)).toContain(dossierInScope.body.data.id)
    })
  })
})
