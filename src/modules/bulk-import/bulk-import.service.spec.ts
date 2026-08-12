import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { BulkImportService } from './bulk-import.service'
import { Importer, ImporterColumn, RequestMeta } from './importers/importer.interface'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['SYSTEM_ADMINISTRATOR'],
  platformRole: null,
  tokenVersion: 1,
}

class FakeImporter implements Importer {
  importType = 'user_invite'
  label = 'Bulk invite users'
  requiredPermission = 'users.invite'
  columns: ImporterColumn[] = [
    { key: 'email', label: 'Email', required: true, aliases: ['Email Address'] },
    { key: 'roleKeys', label: 'Roles', required: true, aliases: ['Role', 'Role(s)'] },
  ]
  committed: Record<string, string>[] = []

  validateRow(row: Record<string, string>): string[] {
    const errors: string[] = []
    if (!row.email || !row.email.includes('@')) errors.push('Invalid email')
    return errors
  }

  async commitRow(
    _actor: AuthenticatedUser,
    row: Record<string, string>,
    _meta: RequestMeta,
  ): Promise<void> {
    await Promise.resolve()
    if (row.email === 'already-exists@example.com') {
      throw new Error('An account already exists for this email address')
    }
    this.committed.push(row)
  }
}

/** A second, differently-permissioned importer — exists purely to prove `BulkImportService` checks each importer's *own* `requiredPermission`, not a single shared one. */
class FakeProductImporter implements Importer {
  importType = 'product'
  label = 'Bulk import products'
  requiredPermission = 'master_data.manage'
  columns: ImporterColumn[] = [{ key: 'brandName', label: 'Brand Name', required: true }]
  validateRow(): string[] {
    return []
  }
  async commitRow(): Promise<void> {
    await Promise.resolve()
  }
}

/** A third, differently-permissioned importer — exists purely to keep the constructor's real arity honest as more importers register (Stage 14's `clinical_trial_patient`). */
class FakeClinicalTrialSubjectImporter implements Importer {
  importType = 'clinical_trial_patient'
  label = 'Bulk import clinical trial subjects'
  requiredPermission = 'pv.manage_clinical_trials'
  columns: ImporterColumn[] = [{ key: 'trialReference', label: 'Trial Reference', required: true }]
  validateRow(): string[] {
    return []
  }
  async commitRow(): Promise<void> {
    await Promise.resolve()
  }
}

function buildHarness(grantedPermissions: string[] = ['users.invite', 'master_data.manage']) {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const rls = { runAsCompany: (_companyId: string, fn: (tx: unknown) => unknown) => fn({}) }
  const getPermissionsForUser = jest.fn().mockResolvedValue(new Set(grantedPermissions))
  const rolesService = { getPermissionsForUser } as never

  const fakeImporter = new FakeImporter()
  const fakeProductImporter = new FakeProductImporter()
  const fakeClinicalTrialSubjectImporter = new FakeClinicalTrialSubjectImporter()
  const service = new BulkImportService(
    rls as never,
    auditService,
    rolesService,
    fakeImporter as never,
    fakeProductImporter as never,
    fakeClinicalTrialSubjectImporter as never,
  )
  return { service, fakeImporter, fakeProductImporter, auditLog }
}

describe('BulkImportService', () => {
  describe('getImporter()', () => {
    it('404s on an unregistered import type', () => {
      const { service } = buildHarness()
      expect(() => service.getImporter('not_a_real_type')).toThrow(NotFoundException)
    })

    it('registers more than one importer, each independently resolvable by its own importType', () => {
      const { service } = buildHarness()
      expect(service.getImporter('user_invite').requiredPermission).toBe('users.invite')
      expect(service.getImporter('product').requiredPermission).toBe('master_data.manage')
    })
  })

  describe('permission gating', () => {
    it("rejects preview() for an actor missing that importer's own requiredPermission", async () => {
      const { service } = buildHarness([])
      await expect(
        service.preview(actor, 'user_invite', 'email,roleKeys\na@b.com,QPPV'),
      ).rejects.toThrow(ForbiddenException)
    })

    it('rejects commit() the same way', async () => {
      const { service } = buildHarness([])
      await expect(
        service.commit(actor, 'user_invite', [{ email: 'a@b.com', roleKeys: 'QPPV' }], {}),
      ).rejects.toThrow(ForbiddenException)
    })

    it('an actor with only master_data.manage can run the product importer but not user_invite', async () => {
      const { service } = buildHarness(['master_data.manage'])
      await expect(service.preview(actor, 'product', 'brandName\nAmoxil')).resolves.toBeDefined()
      await expect(
        service.preview(actor, 'user_invite', 'email,roleKeys\na@b.com,QPPV'),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('preview()', () => {
    it("splits rows into valid/invalid buckets using the importer's own validation", async () => {
      const { service } = buildHarness()
      const csv = 'email,roleKeys\ngood@example.com,QPPV\nbad-email,QPPV'

      const result = await service.preview(actor, 'user_invite', csv)

      expect(result.totalRows).toBe(2)
      expect(result.validRows).toHaveLength(1)
      expect(result.validRows[0].data.email).toBe('good@example.com')
      expect(result.invalidRows).toHaveLength(1)
      expect(result.invalidRows[0].errors).toContain('Invalid email')
    })

    it('numbers rows starting from 1, matching their position in the CSV data rows', async () => {
      const { service } = buildHarness()
      const csv = 'email,roleKeys\nbad-1,QPPV\ngood@example.com,QPPV\nbad-2,QPPV'
      const result = await service.preview(actor, 'user_invite', csv)

      expect(result.invalidRows.map((r) => r.rowNumber)).toEqual([1, 3])
      expect(result.validRows.map((r) => r.rowNumber)).toEqual([2])
    })

    it("remaps a real spreadsheet's own header spelling onto the importer's canonical column key via aliases", async () => {
      const { service } = buildHarness()
      // Neither header is the technical "email"/"roleKeys" name — both are declared aliases.
      const csv = 'Email Address,Role(s)\ngood@example.com,QPPV'

      const result = await service.preview(actor, 'user_invite', csv)

      expect(result.validRows).toHaveLength(1)
      expect(result.validRows[0].data.email).toBe('good@example.com')
      expect(result.validRows[0].data.roleKeys).toBe('QPPV')
    })

    it('header matching is case-insensitive and tolerant of surrounding whitespace', async () => {
      const { service } = buildHarness()
      const csv = ' EMAIL ADDRESS , role(s) \ngood@example.com,QPPV'

      const result = await service.preview(actor, 'user_invite', csv)

      expect(result.validRows).toHaveLength(1)
      expect(result.validRows[0].data.email).toBe('good@example.com')
    })
  })

  describe('commit()', () => {
    it('commits every valid row and reports per-row failures without aborting the batch', async () => {
      const { service, fakeImporter, auditLog } = buildHarness()
      const rows = [
        { email: 'good1@example.com', roleKeys: 'QPPV' },
        { email: 'already-exists@example.com', roleKeys: 'QPPV' },
        { email: 'good2@example.com', roleKeys: 'QPPV' },
      ]

      const result = await service.commit(actor, 'user_invite', rows, {})

      expect(result.committed).toBe(2)
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0]).toEqual({
        rowNumber: 2,
        success: false,
        error: 'An account already exists for this email address',
      })
      expect(fakeImporter.committed.map((r) => r.email)).toEqual([
        'good1@example.com',
        'good2@example.com',
      ])
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'bulk_import_completed',
          newValue: expect.objectContaining({ committed: 2, failedCount: 1 }),
        }),
      )
    })

    it('re-validates server-side and rejects a row that would fail validation, without calling commitRow', async () => {
      const { service, fakeImporter } = buildHarness()
      const rows = [{ email: 'not-an-email', roleKeys: 'QPPV' }]

      const result = await service.commit(actor, 'user_invite', rows, {})

      expect(result.committed).toBe(0)
      expect(result.failed).toEqual([{ rowNumber: 1, success: false, error: 'Invalid email' }])
      expect(fakeImporter.committed).toHaveLength(0)
    })
  })
})
