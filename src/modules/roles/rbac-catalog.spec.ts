import { PERMISSIONS, ROLES } from '../../../prisma/rbac.seed-data'
import { TENANT_ROLE_KEYS } from '../../common/tenant-roles.const'

const PLATFORM_ROLE_KEYS = ['super_admin', 'operations', 'support', 'regulatory_lead']
const PERMISSION_KEYS = new Set(PERMISSIONS.map((p) => p.key))

describe('RBAC catalog (rbac.seed-data.ts)', () => {
  it('every role key matches either the tenant roleKeys vocabulary or the PlatformRole enum — never both, never neither', () => {
    for (const role of ROLES) {
      if (role.isPlatform) {
        expect(PLATFORM_ROLE_KEYS).toContain(role.key)
        expect(TENANT_ROLE_KEYS as readonly string[]).not.toContain(role.key)
      } else {
        expect(TENANT_ROLE_KEYS as readonly string[]).toContain(role.key)
        expect(PLATFORM_ROLE_KEYS).not.toContain(role.key)
      }
    }
  })

  it('every permission a role grants exists in the PERMISSIONS catalog', () => {
    for (const role of ROLES) {
      for (const permissionKey of role.permissions) {
        expect(PERMISSION_KEYS.has(permissionKey)).toBe(true)
      }
    }
  })

  it('has no duplicate role or permission keys', () => {
    expect(new Set(ROLES.map((r) => r.key)).size).toBe(ROLES.length)
    expect(new Set(PERMISSIONS.map((p) => p.key)).size).toBe(PERMISSIONS.length)
  })

  it('covers every tenant role and all 4 platform roles', () => {
    const tenantRoleKeys = ROLES.filter((r) => !r.isPlatform).map((r) => r.key)
    expect(new Set(tenantRoleKeys)).toEqual(new Set(TENANT_ROLE_KEYS))

    const platformRoleKeys = ROLES.filter((r) => r.isPlatform).map((r) => r.key)
    expect(new Set(platformRoleKeys)).toEqual(new Set(PLATFORM_ROLE_KEYS))
  })

  // The capability matrix (safemeds-user-types.md §D) — spot-check the
  // rows that gate real, already-built endpoints so a future edit to the
  // seed data can't silently loosen or tighten access without a test
  // failing.
  describe.each([
    ['SYSTEM_ADMINISTRATOR', 'users.invite', true],
    ['SYSTEM_ADMINISTRATOR', 'users.deactivate', true],
    ['SYSTEM_ADMINISTRATOR', 'security_policy.manage', true],
    ['SYSTEM_ADMINISTRATOR', 'pv.sign_icsr', false],
    ['QPPV', 'pv.sign_icsr', true],
    ['QPPV', 'users.invite', false],
    ['DISPENSING_PHARMACIST', 'pv.capture_case', true],
    ['DISPENSING_PHARMACIST', 'pv.triage_case', false],
    ['QUALITY_MANAGER', 'quality.close_capa', true],
    ['QUALITY_ASSOCIATE', 'quality.close_capa', false],
    ['EXECUTIVE_READONLY', 'records.view_all', true],
    ['EXECUTIVE_READONLY', 'users.invite', false],
    ['super_admin', 'platform.tenants.suspend', true],
    ['operations', 'platform.tenants.suspend', false],
    ['operations', 'platform.registrations.review', true],
  ])('role %s × permission %s', (roleKey, permissionKey, expected) => {
    it(`grants=${expected}`, () => {
      const role = ROLES.find((r) => r.key === roleKey)
      expect(role).toBeDefined()
      expect(role!.permissions.includes(permissionKey)).toBe(expected)
    })
  })
})
