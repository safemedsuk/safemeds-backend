import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { newId } from '../src/common/id'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

/**
 * QualCloud Phase 2 Pass C — flows that touch no R2 upload, walked against the
 * real running app and real Postgres:
 *
 * - Document numbering: admin-only scheme save (audited), validation of token
 *   order / separator / duplicate type initials, system numbers following the
 *   saved scheme, manual numbers (numeric-only refused, case-insensitive
 *   uniqueness), and a system number that skips a manually taken value.
 * - Product-linked specifications: a finished product must link a catalogue product,
 *   and a linked specification shows up under its product.
 * - Risk register export: CSV and Excel downloads, bad format refused, audited.
 * - APQR: default calendar-year period (UTC), draft download refused, the
 *   archived-file gate. The review step itself uploads a PDF and an Excel file
 *   to R2, which Jest cannot reach (the documented TLS gotcha), so it is covered
 *   by the mocked-I/O unit spec `pqr.service.spec.ts` instead.
 */
// Each case makes several real HTTP + DB round trips; Jest's 5s default is too
// tight on a loaded box (the 17th test hit 5132ms). Budget only, no assertion change.
jest.setTimeout(20000)

describe('QualCloud Pass C — numbering, risk export, APQR (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let admin: TestActor
  let manager: TestActor
  let sopDefinitionId: string

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
      data: { id: roleId, key, name: key, description: 'pass c fixture', isPlatform: false },
    })
    for (const permKey of permissionKeys) {
      const permission = await testPrisma.permission.upsert({
        where: { key: permKey },
        create: { id: randomUUID(), key: permKey, description: 'pass c fixture' },
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
        name: 'Pass C Pharma Ltd',
        companyType: 'manufacturer',
        homeCountryId: countryId,
        status: 'active',
      },
    })

    await seedRole('QUALITY_MANAGER', [
      'quality.view_all',
      'quality.view_pqr',
      'quality.manage_pqr',
      'quality.manage_documents',
      'quality.manage_capa',
    ])
    await seedRole('COMPANY_ADMIN_FIXTURE', ['company_profile.manage', 'quality.view_all'])

    // quality_controlled_document: a single draft state is enough to instantiate a workflow.
    sopDefinitionId = randomUUID()
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

    manager = await createAuthenticatedActor(app, testPrisma, {
      companyId,
      roleKeys: ['QUALITY_MANAGER'],
    })
    admin = await createAuthenticatedActor(app, testPrisma, {
      companyId,
      roleKeys: ['COMPANY_ADMIN_FIXTURE'],
    })
  })

  // ------------------------------------------------------------ numbering

  describe('document numbering', () => {
    const scheme = {
      companyInitials: 'who',
      tokenOrder: ['year', 'sequence', 'type', 'company'],
      separator: '/',
      types: [
        { documentType: 'sop', initials: 'sop' },
        { documentType: 'policy', initials: 'POL' },
      ],
    }

    it('shows the default scheme with a live next-number preview for each document type', async () => {
      const res = await authed(
        request(httpServer(app)).get('/api/v1/quality/config/document-numbering'),
        manager,
      ).expect(200)
      const sop = (
        res.body.data.types as Array<{
          documentType: string
          nextNumber: string
          initialsIsDefault: boolean
        }>
      ).find((t) => t.documentType === 'sop')!
      expect(sop.initialsIsDefault).toBe(true)
      expect(sop.nextNumber).toMatch(new RegExp(`-SOP-${new Date().getUTCFullYear()}-0001$`))
    })

    it('an administrator saves a scheme; new numbers follow it; the change is audited with old and new values', async () => {
      await authedWrite(
        request(httpServer(app)).put('/api/v1/quality/config/document-numbering'),
        admin,
      )
        .send(scheme)
        .expect(200)

      const after = await authed(
        request(httpServer(app)).get('/api/v1/quality/config/document-numbering'),
        admin,
      ).expect(200)
      const sop = (
        after.body.data.types as Array<{
          documentType: string
          initials: string
          separator: string
        }>
      ).find((t) => t.documentType === 'sop')!
      expect(sop.initials).toBe('SOP')
      expect(sop.separator).toBe('/')

      const year = new Date().getUTCFullYear()
      const created = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/sops'),
        manager,
      )
        .send({ title: 'Cleaning SOP', documentType: 'sop' })
        .expect(201)
      expect(created.body.data.documentNumber).toBe(`${year}/0001/SOP/WHO`)

      const audit = await withBypass((tx) =>
        tx.auditEntry.findMany({
          where: { companyId, action: 'document_numbering_updated' },
          select: { oldValue: true, newValue: true },
        }),
      )
      expect(audit.length).toBeGreaterThanOrEqual(1)
      expect(audit[0].newValue).toBeTruthy()
    })

    it('refuses a save from a user without company administration rights', async () => {
      await authedWrite(
        request(httpServer(app)).put('/api/v1/quality/config/document-numbering'),
        manager,
      )
        .send(scheme)
        .expect(403)
    })

    it('refuses two document types that would share initials, so their numbers can never collide', async () => {
      const res = await authedWrite(
        request(httpServer(app)).put('/api/v1/quality/config/document-numbering'),
        admin,
      )
        .send({
          companyInitials: 'WHO',
          tokenOrder: ['company', 'type', 'year', 'sequence'],
          separator: '-',
          types: [
            { documentType: 'sop', initials: 'XX' },
            { documentType: 'policy', initials: 'XX' },
          ],
        })
        .expect(409)
      expect(res.body.error.code).toBe('TYPE_INITIALS_DUPLICATE')
    })

    it('refuses an invalid token order and an unoffered separator', async () => {
      await authedWrite(
        request(httpServer(app)).put('/api/v1/quality/config/document-numbering'),
        admin,
      )
        .send({
          companyInitials: 'WHO',
          tokenOrder: ['company', 'company', 'year', 'sequence'],
          separator: '-',
        })
        .expect(400)
      await authedWrite(
        request(httpServer(app)).put('/api/v1/quality/config/document-numbering'),
        admin,
      )
        .send({
          companyInitials: 'WHO',
          tokenOrder: ['company', 'type', 'year', 'sequence'],
          separator: '#',
        })
        .expect(400)
    })

    it('a manual number cannot be digits only, and must be unique per company ignoring case', async () => {
      const numeric = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/sops'),
        manager,
      )
        .send({ title: 'Manual one', documentType: 'sop', documentNumber: '0001' })
        .expect(400)
      expect(numeric.body.error.code).toBe('DOCUMENT_NUMBER_NUMERIC_ONLY')
      expect(numeric.body.error.message).toContain('0001')

      await authedWrite(request(httpServer(app)).post('/api/v1/quality/sops'), manager)
        .send({ title: 'Manual two', documentType: 'sop', documentNumber: 'MY-SOP-A' })
        .expect(201)
      const dup = await authedWrite(request(httpServer(app)).post('/api/v1/quality/sops'), manager)
        .send({ title: 'Manual three', documentType: 'sop', documentNumber: 'my-sop-a' })
        .expect(409)
      expect(dup.body.error.code).toBe('DOCUMENT_NUMBER_TAKEN')
    })

    it('a system number skips a value a person already typed in, and never reuses it', async () => {
      const preview = await authed(
        request(httpServer(app)).get('/api/v1/quality/config/document-numbering'),
        manager,
      ).expect(200)
      const next = (
        preview.body.data.types as Array<{ documentType: string; nextNumber: string }>
      ).find((t) => t.documentType === 'sop')!.nextNumber

      await authedWrite(request(httpServer(app)).post('/api/v1/quality/sops'), manager)
        .send({ title: 'Typed in', documentType: 'sop', documentNumber: next })
        .expect(201)

      const generated = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/sops'),
        manager,
      )
        .send({ title: 'Generated', documentType: 'sop' })
        .expect(201)
      expect(generated.body.data.documentNumber).not.toBe(next)
    })
  })

  // ------------------------------------------------------------ risk export

  describe('risk register export', () => {
    beforeEach(async () => {
      await authedWrite(request(httpServer(app)).post('/api/v1/quality/risk-assessments'), manager)
        .send({
          title: 'Seal failure, blister line',
          severity: 4,
          probability: 3,
          detectability: 2,
          mitigationActions: 'Add check',
        })
        .expect(201)
    })

    it('exports the register as CSV with the agreed header and the row, and audits the export', async () => {
      const res = await authed(
        request(httpServer(app)).get('/api/v1/quality/risk-assessments/export?format=csv'),
        manager,
      )
        .buffer(true)
        .parse((res: unknown, cb: (err: Error | null, body: string) => void) => {
          const stream = res as NodeJS.ReadableStream
          let data = ''
          stream.on('data', (c: Buffer | string) => (data += c.toString()))
          stream.on('end', () => cb(null, data))
        })
        .expect(200)
      expect(String(res.headers['content-type'])).toContain('text/csv')
      const text = res.body as unknown as string
      expect(text.split('\r\n')[0]).toContain('Title,Method,Severity')
      expect(text).toContain('Seal failure, blister line')

      const audit = await withBypass((tx) =>
        tx.auditEntry.findFirst({ where: { companyId, action: 'risk_register_exported' } }),
      )
      expect(audit).not.toBeNull()
    })

    it('exports an Excel workbook (a zip container) by default', async () => {
      const res = await authed(
        request(httpServer(app)).get('/api/v1/quality/risk-assessments/export'),
        manager,
      )
        .buffer(true)
        .parse((res: unknown, cb: (err: Error | null, body: Buffer) => void) => {
          const stream = res as NodeJS.ReadableStream
          const chunks: Buffer[] = []
          stream.on('data', (c: Buffer) => chunks.push(c))
          stream.on('end', () => cb(null, Buffer.concat(chunks)))
        })
        .expect(200)
      expect(String(res.headers['content-type'])).toContain('spreadsheetml')
      expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK')
    })

    it('refuses any other format', async () => {
      await authed(
        request(httpServer(app)).get('/api/v1/quality/risk-assessments/export?format=pdf'),
        manager,
      ).expect(400)
    })
  })

  // ------------------------------------------------------------ product-linked specifications

  describe('product-linked specifications', () => {
    let productId: string

    beforeEach(async () => {
      const product = await withBypass((tx) =>
        tx.product.create({
          data: {
            id: newId(),
            companyId,
            brandName: 'Amoxiclav',
            genericName: 'Amoxicillin/Clavulanate',
            productCategory: 'medicinal',
            dosageForm: 'tablet',
            strength: '625mg',
          },
        }),
      )
      productId = product.id
    })

    it('refuses a finished-product specification that is not linked to a product', async () => {
      const res = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/specifications'),
        manager,
      )
        .send({
          specificationNumber: 'SPEC-P1',
          title: 'Amoxiclav 625',
          specificationType: 'finished_product',
        })
        .expect(400)
      expect(res.body.error.code).toBe('PRODUCT_REQUIRED')
    })

    it('refuses a product id that is not in this company catalogue', async () => {
      const res = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/specifications'),
        manager,
      )
        .send({
          specificationNumber: 'SPEC-P2',
          title: 'Amoxiclav 625',
          specificationType: 'finished_product',
          productId: newId(),
        })
        .expect(400)
      expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND')
    })

    it('links a specification to a product and lists it under that product', async () => {
      const created = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/specifications'),
        manager,
      )
        .send({
          specificationNumber: 'SPEC-P3',
          title: 'Amoxiclav 625 tablets',
          specificationType: 'finished_product',
          productId,
          parameters: [{ parameterName: 'Assay', lowerLimit: '95', upperLimit: '105', unit: '%' }],
        })
        .expect(201)
      expect(created.body.data.productId).toBe(productId)

      const listed = await authed(
        request(httpServer(app)).get(`/api/v1/quality/specifications?productId=${productId}`),
        manager,
      ).expect(200)
      const rows = listed.body.data as Array<{ specificationNumber: string; parameters: unknown[] }>
      expect(rows.map((r) => r.specificationNumber)).toEqual(['SPEC-P3'])
      expect(rows[0].parameters).toHaveLength(1)
    })
  })

  // ------------------------------------------------------------ APQR

  describe('APQR assembly and download gate', () => {
    let productId: string

    beforeEach(async () => {
      const product = await withBypass((tx) =>
        tx.product.create({
          data: {
            id: newId(),
            companyId,
            brandName: 'Amoxiclav',
            genericName: 'Amoxicillin/Clavulanate',
            productCategory: 'medicinal',
            dosageForm: 'tablet',
            strength: '500mg',
          },
        }),
      )
      productId = product.id
    })

    it('assembles with no dates and defaults to 1 January to 31 December of the current year (UTC)', async () => {
      const res = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/pqr/assemble'),
        manager,
      )
        .send({ productId })
        .expect(201)
      const year = new Date().getUTCFullYear()
      const body = res.body as {
        data: {
          periodStart: string
          periodEnd: string
          status: string
          assembledData: { snapshot?: unknown }
        }
      }
      expect(body.data.periodStart.slice(0, 10)).toBe(`${year}-01-01`)
      expect(body.data.periodEnd.slice(0, 10)).toBe(`${year}-12-31`)
      expect(body.data.status).toBe('draft')
      expect(body.data.assembledData.snapshot).toBeDefined()
    })

    it('includes a batch manufactured in the period in the frozen snapshot', async () => {
      const year = new Date().getUTCFullYear()
      await withBypass((tx) =>
        tx.batch.create({
          data: {
            id: newId(),
            companyId,
            productId,
            batchNumber: 'AMX-0001',
            manufacturedOn: new Date(Date.UTC(year, 2, 1)),
            expiresOn: new Date(Date.UTC(year + 2, 2, 1)),
          },
        }),
      )
      const res = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/pqr/assemble'),
        manager,
      )
        .send({ productId, periodStart: `${year}-01-01`, periodEnd: `${year}-12-31` })
        .expect(201)
      expect(res.body.data.assembledData.batchCount).toBe(1)
      expect(res.body.data.assembledData.snapshot.batches[0].batchNumber).toBe('AMX-0001')
    })

    it('refuses to download an APQR that has not been reviewed and signed', async () => {
      const created = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/pqr/assemble'),
        manager,
      )
        .send({ productId })
        .expect(201)
      const res = await authed(
        request(httpServer(app)).get(
          `/api/v1/quality/pqr/${created.body.data.id}/download?format=pdf`,
        ),
        manager,
      ).expect(409)
      expect(res.body.error.code).toBe('APQR_NOT_SIGNED')
    })

    it('rejects a download format other than pdf or xlsx', async () => {
      const created = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/pqr/assemble'),
        manager,
      )
        .send({ productId })
        .expect(201)
      await authed(
        request(httpServer(app)).get(
          `/api/v1/quality/pqr/${created.body.data.id}/download?format=docx`,
        ),
        manager,
      ).expect(400)
    })
  })
})
