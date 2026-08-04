import { AuditService, diffForAudit } from './audit.service'

describe('diffForAudit', () => {
  it('only includes fields that actually changed', () => {
    const { oldValue, newValue } = diffForAudit(
      { minPasswordLength: 12, sessionTimeoutMinutes: 30, mfaRequiredForSignatureRoles: false },
      { minPasswordLength: 12, sessionTimeoutMinutes: 50, mfaRequiredForSignatureRoles: false },
    )

    expect(oldValue).toEqual({ sessionTimeoutMinutes: 30 })
    expect(newValue).toEqual({ sessionTimeoutMinutes: 50 })
  })

  it('returns no diff when nothing changed', () => {
    const result = diffForAudit({ a: 1, b: 'x' }, { a: 1, b: 'x' })
    expect(result.oldValue).toBeUndefined()
    expect(result.newValue).toBeUndefined()
  })

  it('handles a field appearing for the first time (before is null/undefined)', () => {
    const { oldValue, newValue } = diffForAudit(null, { roleKeys: ['QPPV'] })
    expect(oldValue).toEqual({ roleKeys: undefined })
    expect(newValue).toEqual({ roleKeys: ['QPPV'] })
  })
})

describe('AuditService.log redaction', () => {
  it('redacts deny-listed fields but leaves everything else untouched', async () => {
    const created = jest.fn().mockResolvedValue(undefined)
    const tx = { auditEntry: { create: created } } as never

    const service = new AuditService(undefined as never, undefined as never)
    await service.log(tx, {
      action: 'password_reset_forced',
      recordType: 'app_user',
      recordId: 'user-1',
      oldValue: { passwordHash: 'argon2id$...', mustChangePassword: false },
      newValue: { passwordHash: 'argon2id$...', mustChangePassword: true },
    })

    const data = created.mock.calls[0][0].data
    expect(data.oldValue).toEqual({ passwordHash: '[REDACTED]', mustChangePassword: false })
    expect(data.newValue).toEqual({ passwordHash: '[REDACTED]', mustChangePassword: true })
  })

  it('passes through non-sensitive object values unchanged', async () => {
    const created = jest.fn().mockResolvedValue(undefined)
    const tx = { auditEntry: { create: created } } as never

    const service = new AuditService(undefined as never, undefined as never)
    await service.log(tx, {
      action: 'invitation_created',
      recordType: 'invitation',
      recordId: 'inv-1',
      newValue: { email: 'delivered@resend.dev', roleKeys: ['QPPV'] },
    })

    const data = created.mock.calls[0][0].data
    expect(data.newValue).toEqual({ email: 'delivered@resend.dev', roleKeys: ['QPPV'] })
    expect(data.oldValue).toBeUndefined()
  })
})
