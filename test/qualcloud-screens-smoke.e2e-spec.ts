import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { PERMISSIONS, ROLES } from '../prisma/rbac.seed-data'
import { newId } from '../src/common/id'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

/**
 * Smoke test for the QualCloud and recall screens. Every list call here is the
 * same path and query string the matching frontend screen sends, signed in as a
 * real QUALITY_MANAGER with the exact permission grants from the seed data.
 * A failure here means a screen will show an error on first load.
 */
const SCREEN_CALLS: Array<{ screen: string; path: string }> = [
  {
    screen: 'Waste Disposal (cases)',
    path: '/api/v1/quality/waste-disposal-cases?page=1&limit=100',
  },
  {
    screen: 'Waste Disposal (open cases)',
    path: '/api/v1/quality/waste-disposal-cases?page=1&limit=100&status=open',
  },
  { screen: 'Waste Disposal (methods)', path: '/api/v1/quality/waste-disposal-methods' },
  {
    screen: 'Waste Disposal (legacy records)',
    path: '/api/v1/quality/waste-disposal?page=1&limit=20',
  },
  {
    screen: 'Falsified Product Reports',
    path: '/api/v1/quality/falsified-product-reports?page=1&limit=20',
  },
  { screen: 'Validation & CSV', path: '/api/v1/quality/validation-protocols?page=1&limit=20' },
  {
    screen: 'Environmental Monitoring',
    path: '/api/v1/quality/environmental-monitoring?page=1&limit=50',
  },
  {
    screen: 'Environmental Monitoring (excursions)',
    path: '/api/v1/quality/environmental-monitoring?page=1&limit=50&excursionOnly=true',
  },
  { screen: 'Stability Studies', path: '/api/v1/quality/stability-studies' },
  { screen: 'Recalls list', path: '/api/v1/recalls?page=1&limit=20' },
  { screen: 'Recall stakeholders', path: '/api/v1/stakeholders?page=1&limit=100' },
  { screen: 'Master Dashboard', path: '/api/v1/reporting/dashboard' },
  {
    screen: 'Inspection Readiness (All Modules)',
    path: '/api/v1/reporting/inspection-readiness-overview',
  },
  { screen: 'Deadlines & Obligations', path: '/api/v1/reporting/obligations' },
  { screen: 'Executive Dashboard', path: '/api/v1/reporting/executive-dashboard' },
  { screen: 'Notifications', path: '/api/v1/notifications' },
  { screen: 'Notifications (unread only)', path: '/api/v1/notifications?unreadOnly=true' },
  { screen: 'Notifications (unread count)', path: '/api/v1/notifications/unread-count' },
  {
    screen: 'Controlled documents (reader picker)',
    path: '/api/v1/quality/sops/assignable-readers',
  },
  { screen: 'Severity definitions', path: '/api/v1/quality/config/severity-definitions' },
]

describe('QualCloud and recall screens — list calls load for a Quality Manager (e2e)', () => {
  let app: INestApplication
  let manager: TestActor

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    const countryId = newId()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    const companyId = newId()
    await testPrisma.company.create({
      data: {
        id: companyId,
        name: 'Screen Smoke Co',
        companyType: 'manufacturer',
        homeCountryId: countryId,
        status: 'active',
      },
    })

    for (const p of PERMISSIONS) {
      await testPrisma.permission.upsert({
        where: { key: p.key },
        create: { id: randomUUID(), key: p.key, description: p.description },
        update: {},
      })
    }
    for (const role of ROLES) {
      const roleId = randomUUID()
      await testPrisma.role.create({
        data: {
          id: roleId,
          key: role.key,
          name: role.name,
          description: role.description,
          isPlatform: role.isPlatform,
        },
      })
      const perms = await testPrisma.permission.findMany({
        where: { key: { in: role.permissions } },
      })
      for (const perm of perms) {
        await testPrisma.rolePermission.create({ data: { roleId, permissionId: perm.id } })
      }
    }

    manager = await createAuthenticatedActor(app, testPrisma, {
      companyId,
      roleKeys: ['QUALITY_MANAGER'],
    })
  })

  it.each(SCREEN_CALLS)('$screen loads', async ({ path }) => {
    const res = await request(httpServer(app)).get(path).set('Cookie', manager.cookieHeader)
    expect({ path, status: res.status }).toEqual({ path, status: 200 })
  })
})
