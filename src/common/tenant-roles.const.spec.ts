import { resolveTenantRoleKey, TENANT_ROLE_KEYS, TENANT_ROLE_LABELS } from './tenant-roles.const'

describe('TENANT_ROLE_LABELS', () => {
  it("has exactly one label per role key, matching the frontend's lib/tenant-roles.ts one-for-one", () => {
    expect(Object.keys(TENANT_ROLE_LABELS).sort()).toEqual([...TENANT_ROLE_KEYS].sort())
  })

  it('gets QPPV right, unlike the naive formatRoleLabel() split-and-capitalize', () => {
    expect(TENANT_ROLE_LABELS.QPPV).toBe('QPPV (PV Contact)')
  })
})

describe('resolveTenantRoleKey', () => {
  it('resolves a raw key, any case', () => {
    expect(resolveTenantRoleKey('QPPV')).toBe('QPPV')
    expect(resolveTenantRoleKey('qppv')).toBe('QPPV')
    expect(resolveTenantRoleKey('superintendent_pharmacist')).toBe('SUPERINTENDENT_PHARMACIST')
  })

  it('resolves a human-friendly label, any case', () => {
    expect(resolveTenantRoleKey('Superintendent Pharmacist')).toBe('SUPERINTENDENT_PHARMACIST')
    expect(resolveTenantRoleKey('superintendent pharmacist')).toBe('SUPERINTENDENT_PHARMACIST')
    expect(resolveTenantRoleKey('QPPV (PV Contact)')).toBe('QPPV')
    expect(resolveTenantRoleKey('qppv (pv contact)')).toBe('QPPV')
  })

  it('trims surrounding whitespace', () => {
    expect(resolveTenantRoleKey('  QPPV  ')).toBe('QPPV')
  })

  it('returns null for anything unrecognized, rather than guessing', () => {
    expect(resolveTenantRoleKey('Not A Real Role')).toBeNull()
    expect(resolveTenantRoleKey('')).toBeNull()
  })
})
