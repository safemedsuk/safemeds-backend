import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RbacAdminService } from './rbac-admin.service'

const actor: AuthenticatedUser = {
  sub: 'super-admin-1',
  companyId: null,
  roleKeys: [],
  platformRole: 'super_admin',
  tokenVersion: 1,
}

function buildHarness() {
  const permission = { findMany: jest.fn(), create: jest.fn() }
  const role = { findUnique: jest.fn(), create: jest.fn() }
  const rolePermission = { deleteMany: jest.fn(), createMany: jest.fn() }
  const user = { findMany: jest.fn(), updateManyAndReturn: jest.fn() }

  const tx = { permission, role, rolePermission, user }
  const prisma = { permission, role }

  const runWithPlatformAccess = jest.fn(
    (_actorUserId: string, _reason: string, fn: (tx: unknown) => unknown) => fn(tx),
  )
  const rls = { runWithPlatformAccess } as never

  const service = new RbacAdminService(prisma as never, rls)
  return { service, permission, role, rolePermission, user, runWithPlatformAccess }
}

describe('RbacAdminService', () => {
  it('listPermissions() shapes each permission with the role keys that hold it', async () => {
    const { service, permission } = buildHarness()
    permission.findMany.mockResolvedValue([
      { key: 'pv.sign_icsr', description: 'Sign an ICSR', roles: [{ role: { key: 'QPPV' } }] },
      {
        key: 'users.invite',
        description: 'Invite users',
        roles: [{ role: { key: 'SYSTEM_ADMINISTRATOR' } }, { role: { key: 'QPPV' } }],
      },
    ])

    const result = await service.listPermissions()

    expect(result).toEqual([
      { key: 'pv.sign_icsr', description: 'Sign an ICSR', roleKeys: ['QPPV'] },
      {
        key: 'users.invite',
        description: 'Invite users',
        roleKeys: ['QPPV', 'SYSTEM_ADMINISTRATOR'],
      },
    ])
  })

  it('createPermission() creates a real, inert-until-wired-up permission row', async () => {
    const { service, permission } = buildHarness()
    permission.create.mockResolvedValue({
      key: 'pv.new_capability',
      description: 'A brand new capability',
    })

    const created = await service.createPermission({
      key: 'pv.new_capability',
      description: 'A brand new capability',
    })

    expect(created).toEqual({ key: 'pv.new_capability', description: 'A brand new capability' })
  })

  it('createRole() 404s when any requested permission key does not exist', async () => {
    const { service, permission } = buildHarness()
    permission.findMany.mockResolvedValue([{ key: 'pv.capture_case', id: 'p1' }])

    await expect(
      service.createRole({
        key: 'FPPV',
        name: 'Focal Person for PV',
        description: 'Distributor-level PV contact',
        permissions: ['pv.capture_case', 'pv.does_not_exist'],
      }),
    ).rejects.toMatchObject({ response: { code: 'UNKNOWN_PERMISSIONS' } })
  })

  it('createRole() creates a real role wired to real RolePermission rows — proving the FPPV gap this admin panel exists to close is now closeable without a code change', async () => {
    const { service, permission, role } = buildHarness()
    permission.findMany.mockResolvedValue([{ key: 'pv.capture_case', id: 'p1' }])
    role.create.mockResolvedValue({
      key: 'FPPV',
      name: 'Focal Person for PV',
      description: 'Distributor-level PV contact',
      isPlatform: false,
    })

    const created = await service.createRole({
      key: 'FPPV',
      name: 'Focal Person for PV',
      description: 'Distributor-level PV contact',
      permissions: ['pv.capture_case'],
    })

    expect(created.key).toBe('FPPV')
    expect(role.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          key: 'FPPV',
          permissions: { create: [{ permissionId: 'p1' }] },
        }),
      }),
    )
  })

  it('getRoleImpact() counts distinct companies for a tenant role via roleKeys.has', async () => {
    const { service, role, user } = buildHarness()
    role.findUnique.mockResolvedValue({ key: 'QPPV', isPlatform: false })
    user.findMany.mockResolvedValue([{ companyId: 'c1' }, { companyId: 'c1' }, { companyId: 'c2' }])

    const impact = await service.getRoleImpact(actor, 'QPPV')

    expect(impact).toEqual({ roleKey: 'QPPV', userCount: 3, companyCount: 2 })
    expect(user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { roleKeys: { has: 'QPPV' } } }),
    )
  })

  it('getRoleImpact() matches on platformRole (not roleKeys) for a platform role', async () => {
    const { service, role, user } = buildHarness()
    role.findUnique.mockResolvedValue({ key: 'super_admin', isPlatform: true })
    user.findMany.mockResolvedValue([{ companyId: null }])

    const impact = await service.getRoleImpact(actor, 'super_admin')

    expect(impact).toEqual({ roleKey: 'super_admin', userCount: 1, companyCount: 1 })
    expect(user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { platformRole: 'super_admin' } }),
    )
  })

  it('getRoleImpact() 404s for an unknown role', async () => {
    const { service, role } = buildHarness()
    role.findUnique.mockResolvedValue(null)

    await expect(service.getRoleImpact(actor, 'NOT_A_ROLE')).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })

  it('updateRolePermissions() 404s when any requested permission key does not exist', async () => {
    const { service, role, permission } = buildHarness()
    role.findUnique.mockResolvedValue({ id: 'role-1', key: 'QPPV', isPlatform: false })
    permission.findMany.mockResolvedValue([])

    await expect(
      service.updateRolePermissions(actor, 'QPPV', { permissions: ['pv.does_not_exist'] }),
    ).rejects.toMatchObject({
      response: { code: 'UNKNOWN_PERMISSIONS' },
    })
  })

  it('updateRolePermissions() fully replaces RolePermission rows and bumps tokenVersion for every user holding the role', async () => {
    const { service, role, permission, rolePermission, user, runWithPlatformAccess } =
      buildHarness()
    role.findUnique.mockResolvedValue({ id: 'role-1', key: 'QPPV', isPlatform: false })
    permission.findMany.mockResolvedValue([{ key: 'pv.sign_icsr', id: 'p1' }])
    user.updateManyAndReturn.mockResolvedValue([{ companyId: 'c1' }, { companyId: 'c2' }])

    const impact = await service.updateRolePermissions(actor, 'QPPV', {
      permissions: ['pv.sign_icsr'],
    })

    expect(rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 'role-1' } })
    expect(rolePermission.createMany).toHaveBeenCalledWith({
      data: [{ roleId: 'role-1', permissionId: 'p1' }],
    })
    expect(user.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { roleKeys: { has: 'QPPV' } },
        data: { tokenVersion: { increment: 1 } },
      }),
    )
    expect(impact).toEqual({ roleKey: 'QPPV', userCount: 2, companyCount: 2 })
    // The actor's own id (never a hardcoded "system") is the audited actor behind the resulting `platform_access` entry.
    expect(runWithPlatformAccess).toHaveBeenCalledWith(
      actor.sub,
      expect.stringContaining('QPPV'),
      expect.any(Function),
    )
  })

  it("updateRolePermissions() emptying a role's permission list skips createMany entirely rather than calling it with an empty array", async () => {
    const { service, role, permission, rolePermission, user } = buildHarness()
    role.findUnique.mockResolvedValue({
      id: 'role-1',
      key: 'EXECUTIVE_READONLY',
      isPlatform: false,
    })
    permission.findMany.mockResolvedValue([])
    user.updateManyAndReturn.mockResolvedValue([])

    await service.updateRolePermissions(actor, 'EXECUTIVE_READONLY', { permissions: [] })

    expect(rolePermission.deleteMany).toHaveBeenCalled()
    expect(rolePermission.createMany).not.toHaveBeenCalled()
  })
})
