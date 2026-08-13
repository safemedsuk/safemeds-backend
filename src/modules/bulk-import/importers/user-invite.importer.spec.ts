import { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface'
import { UserInviteImporter } from './user-invite.importer'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['SYSTEM_ADMINISTRATOR'],
  platformRole: null,
  tokenVersion: 1,
}

describe('UserInviteImporter', () => {
  function buildImporter() {
    const create = jest.fn().mockResolvedValue(undefined)
    const invitationsService = { create } as never
    return { importer: new UserInviteImporter(invitationsService), create }
  }

  describe('validateRow()', () => {
    it('accepts a valid row using raw role keys', () => {
      const { importer } = buildImporter()
      expect(
        importer.validateRow({
          email: 'jeff@example.com',
          roleKeys: 'QPPV;SUPERINTENDENT_PHARMACIST',
        }),
      ).toEqual([])
    })

    it('accepts a valid row using human-friendly role labels — the same ones shown in "Add User"', () => {
      const { importer } = buildImporter()
      expect(
        importer.validateRow({
          email: 'jeff@example.com',
          roleKeys: 'Superintendent Pharmacist; QPPV (PV Contact)',
        }),
      ).toEqual([])
    })

    it('accepts a friendly label regardless of case', () => {
      const { importer } = buildImporter()
      expect(
        importer.validateRow({ email: 'jeff@example.com', roleKeys: 'superintendent pharmacist' }),
      ).toEqual([])
    })

    it('rejects a missing email', () => {
      const { importer } = buildImporter()
      const errors = importer.validateRow({ email: '', roleKeys: 'QPPV' })
      expect(errors.some((e) => e.includes('Invalid or missing email address'))).toBe(true)
    })

    it('rejects a malformed email', () => {
      const { importer } = buildImporter()
      const errors = importer.validateRow({ email: 'not-an-email', roleKeys: 'QPPV' })
      expect(errors.some((e) => e.includes('Invalid or missing email address'))).toBe(true)
    })

    it('rejects an empty role list and lists the valid role names in the error', () => {
      const { importer } = buildImporter()
      const errors = importer.validateRow({ email: 'jeff@example.com', roleKeys: '' })
      expect(errors.some((e) => e.includes('At least one role is required'))).toBe(true)
      expect(errors.some((e) => e.includes('Superintendent Pharmacist'))).toBe(true)
    })

    it('rejects an unrecognized role, names it, and lists the valid role names', () => {
      const { importer } = buildImporter()
      const errors = importer.validateRow({
        email: 'jeff@example.com',
        roleKeys: 'NOT_A_REAL_ROLE',
      })
      expect(errors.some((e) => e.includes('NOT_A_REAL_ROLE'))).toBe(true)
      expect(errors.some((e) => e.includes('QPPV (PV Contact)'))).toBe(true)
    })
  })

  describe('commitRow()', () => {
    it('parses semicolon-separated raw role keys and delegates to InvitationsService.create()', async () => {
      const { importer, create } = buildImporter()
      await importer.commitRow(
        actor,
        { email: 'jeff@example.com', roleKeys: 'QPPV; SUPERINTENDENT_PHARMACIST ' },
        {},
      )

      expect(create).toHaveBeenCalledWith(
        actor,
        { email: 'jeff@example.com', roleKeys: ['QPPV', 'SUPERINTENDENT_PHARMACIST'] },
        {},
      )
    })

    it('resolves human-friendly role labels to their canonical keys before committing', async () => {
      const { importer, create } = buildImporter()
      await importer.commitRow(
        actor,
        { email: 'jeff@example.com', roleKeys: 'Superintendent Pharmacist; QPPV (PV Contact)' },
        {},
      )

      expect(create).toHaveBeenCalledWith(
        actor,
        { email: 'jeff@example.com', roleKeys: ['SUPERINTENDENT_PHARMACIST', 'QPPV'] },
        {},
      )
    })
  })

  describe('columns', () => {
    it("declares header aliases so a real spreadsheet's own column naming is accepted", () => {
      const { importer } = buildImporter()
      const emailColumn = importer.columns.find((c) => c.key === 'email')!
      const roleColumn = importer.columns.find((c) => c.key === 'roleKeys')!
      expect(emailColumn.aliases).toContain('Email Address')
      expect(roleColumn.aliases).toContain('Roles')
    })
  })
})
