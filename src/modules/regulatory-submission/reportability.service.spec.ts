import { NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ReportabilityService } from './reportability.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const cases = new Map<string, Record<string, unknown>>()
  const authorities = new Map<string, Record<string, unknown>>()
  const rules: Record<string, unknown>[] = []
  const deadlines = new Map<string, Record<string, unknown>>()

  const mockTx = {
    case: {
      findFirst: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(cases.get(where.id) ?? null),
      ),
    },
    regulatoryAuthority: {
      findMany: jest.fn(({ where }: { where: { countryId: string } }) =>
        Promise.resolve([...authorities.values()].filter((a) => a.countryId === where.countryId)),
      ),
    },
    reportingRule: {
      findFirst: jest.fn(
        ({ where }: { where: { authorityId: string; reportTypeId: string; status: string } }) =>
          Promise.resolve(
            rules.find(
              (r) =>
                r.authorityId === where.authorityId &&
                r.reportTypeId === where.reportTypeId &&
                r.status === where.status,
            ) ?? null,
          ),
      ),
    },
    deadline: {
      findUnique: jest.fn(({ where }: { where: { recordType_recordId: { recordId: string } } }) =>
        Promise.resolve(deadlines.get(where.recordType_recordId.recordId) ?? null),
      ),
    },
  }

  const rls = { runAsCompany: (_c: string, fn: (tx: typeof mockTx) => unknown) => fn(mockTx) }
  const service = new ReportabilityService(rls as never)
  return { service, cases, authorities, rules, deadlines }
}

describe('ReportabilityService.assess()', () => {
  it('a foreign case (occurrence country differs from report country) is never individually reportable', async () => {
    const { service, cases } = buildHarness()
    cases.set('case-1', {
      id: 'case-1',
      countryOfOccurrenceId: 'country-ng',
      countryOfReportId: 'country-ke',
      reportTypeId: 'rt-adr',
    })

    const result = await service.assess(actor, 'case-1')
    expect(result.reportable).toBe(false)
    expect(result.isForeign).toBe(true)
    expect(result.reason).toContain('PSUR/PBRER')
  })

  it('a local case with a confirmed active reporting rule and a resolved deadline is reportable', async () => {
    const { service, cases, authorities, rules, deadlines } = buildHarness()
    cases.set('case-1', {
      id: 'case-1',
      countryOfOccurrenceId: 'country-ke',
      countryOfReportId: 'country-ke',
      reportTypeId: 'rt-adr',
    })
    authorities.set('auth-ppb', { id: 'auth-ppb', countryId: 'country-ke', code: 'PPB' })
    rules.push({ authorityId: 'auth-ppb', reportTypeId: 'rt-adr', status: 'active' })
    deadlines.set('case-1', { id: 'deadline-1', dueAt: new Date() })

    const result = await service.assess(actor, 'case-1')
    expect(result.reportable).toBe(true)
    expect(result.isForeign).toBe(false)
    expect(result.authority).toMatchObject({ id: 'auth-ppb' })
    expect(result.deadline).toMatchObject({ id: 'deadline-1' })
  })

  it('a local case with no active reporting rule anywhere is not reportable (no deadline could resolve)', async () => {
    const { service, cases, authorities } = buildHarness()
    cases.set('case-1', {
      id: 'case-1',
      countryOfOccurrenceId: 'country-ke',
      countryOfReportId: 'country-ke',
      reportTypeId: 'rt-unverified',
    })
    authorities.set('auth-ppb', { id: 'auth-ppb', countryId: 'country-ke', code: 'PPB' })
    // No matching ReportingRule pushed — resolveAuthority() returns null.

    const result = await service.assess(actor, 'case-1')
    expect(result.reportable).toBe(false)
    expect(result.isForeign).toBe(false)
    expect(result.reason).toContain('classify')
  })

  it('a local case with a confirmed rule but no deadline computed yet (triage never ran) is not reportable', async () => {
    const { service, cases, authorities, rules } = buildHarness()
    cases.set('case-1', {
      id: 'case-1',
      countryOfOccurrenceId: 'country-ke',
      countryOfReportId: 'country-ke',
      reportTypeId: 'rt-adr',
    })
    authorities.set('auth-ppb', { id: 'auth-ppb', countryId: 'country-ke', code: 'PPB' })
    rules.push({ authorityId: 'auth-ppb', reportTypeId: 'rt-adr', status: 'active' })
    // No deadline row set — Stage 5 triage never ran for this case.

    const result = await service.assess(actor, 'case-1')
    expect(result.reportable).toBe(false)
  })

  it('404s for a case that does not exist in this company', async () => {
    const { service } = buildHarness()
    await expect(service.assess(actor, 'missing-case')).rejects.toThrow(NotFoundException)
  })
})
