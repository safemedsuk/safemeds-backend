import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CountryConfigService } from './country-config.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: null,
  roleKeys: [],
  platformRole: 'super_admin',
  tokenVersion: 1,
}

/**
 * Builds a fake Prisma client whose `$transaction` just invokes the callback
 * with the same fake delegates (no real transaction semantics needed —
 * these tests are about the version-on-write/activation *logic*, not
 * Postgres). Each delegate only implements the methods the service actually
 * calls on it.
 */
function buildHarness() {
  const reportingRule = {
    findFirst: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  }
  const seriousnessDefinition = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  }
  const formSchema = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  }
  const submissionFormat = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  }

  const tables = { reportingRule, seriousnessDefinition, formSchema, submissionFormat }
  const prisma = {
    ...tables,
    $transaction: (fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new CountryConfigService(prisma as never, auditService)
  return { service, ...tables, auditLog }
}

describe('CountryConfigService — reporting rules', () => {
  it('createReportingRuleVersion always starts at version 1 for a brand-new natural key', async () => {
    const { service, reportingRule } = buildHarness()
    reportingRule.findFirst.mockResolvedValue(null)
    reportingRule.create.mockImplementation(({ data }) => Promise.resolve(data))

    const created = await service.createReportingRuleVersion(
      actor,
      {
        authorityId: 'ppb',
        reportTypeId: 'adr',
        seriousnessClass: 'serious',
        windowDays: 15,
        effectiveFrom: '2026-01-01',
      },
      {},
    )

    expect(created.version).toBe(1)
    expect(created.status).toBe('draft')
  })

  it('createReportingRuleVersion increments past the highest existing version for the same natural key', async () => {
    const { service, reportingRule, auditLog } = buildHarness()
    reportingRule.findFirst.mockResolvedValue({ version: 3 })
    reportingRule.create.mockImplementation(({ data }) => Promise.resolve(data))

    const created = await service.createReportingRuleVersion(
      actor,
      {
        authorityId: 'ppb',
        reportTypeId: 'adr',
        seriousnessClass: 'serious',
        windowDays: 7,
        effectiveFrom: '2026-02-01',
      },
      { ip: '10.0.0.1' },
    )

    expect(created.version).toBe(4)
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'reporting_rule_version_created',
        recordId: created.id,
        ip: '10.0.0.1',
      }),
    )
  })

  it('createReportingRuleVersion carries reportingPeriodDays through to the created row when supplied (Stage 0.11)', async () => {
    const { service, reportingRule } = buildHarness()
    reportingRule.findFirst.mockResolvedValue(null)
    reportingRule.create.mockImplementation(({ data }) => Promise.resolve(data))

    const created = await service.createReportingRuleVersion(
      actor,
      {
        authorityId: 'ppb',
        reportTypeId: 'adr',
        seriousnessClass: 'serious',
        windowDays: 7,
        reportingPeriodDays: 180,
        effectiveFrom: '2026-01-01',
      },
      {},
    )

    expect(created.reportingPeriodDays).toBe(180)
  })

  it('createReportingRuleVersion leaves reportingPeriodDays undefined when the rule has no periodic-reporting obligation', async () => {
    const { service, reportingRule } = buildHarness()
    reportingRule.findFirst.mockResolvedValue(null)
    reportingRule.create.mockImplementation(({ data }) => Promise.resolve(data))

    const created = await service.createReportingRuleVersion(
      actor,
      {
        authorityId: 'ppb',
        reportTypeId: 'adr',
        seriousnessClass: 'serious',
        windowDays: 7,
        effectiveFrom: '2026-01-01',
      },
      {},
    )

    expect(created.reportingPeriodDays).toBeUndefined()
  })

  it('createReportingRuleVersion defaults submissionDestination to "regulator" and carries an explicit one through when supplied (Admin Configuration Console — Gap 1)', async () => {
    const { service, reportingRule } = buildHarness()
    reportingRule.findFirst.mockResolvedValue(null)
    reportingRule.create.mockImplementation(({ data }) => Promise.resolve(data))

    const defaulted = await service.createReportingRuleVersion(
      actor,
      {
        authorityId: 'ppb',
        reportTypeId: 'adr',
        seriousnessClass: 'serious',
        windowDays: 7,
        effectiveFrom: '2026-01-01',
      },
      {},
    )
    expect(defaulted.submissionDestination).toBe('regulator')

    const explicit = await service.createReportingRuleVersion(
      actor,
      {
        authorityId: 'ppb',
        reportTypeId: 'trial-sae',
        seriousnessClass: 'serious',
        windowDays: 1,
        submissionDestination: 'ethics_committee_and_trial_portal',
        effectiveFrom: '2026-01-01',
      },
      {},
    )
    expect(explicit.submissionDestination).toBe('ethics_committee_and_trial_portal')
  })

  it('createReportingRuleVersion carries sourceReference through to the created row and the audit entry (Admin Configuration Console — Gap 1)', async () => {
    const { service, reportingRule, auditLog } = buildHarness()
    reportingRule.findFirst.mockResolvedValue(null)
    reportingRule.create.mockImplementation(({ data }) => Promise.resolve(data))

    const created = await service.createReportingRuleVersion(
      actor,
      {
        authorityId: 'ppb',
        reportTypeId: 'adr',
        seriousnessClass: 'fatal',
        windowDays: 7,
        sourceReference: 'GUD/022 §6.1',
        effectiveFrom: '2026-01-01',
      },
      {},
    )

    expect(created.sourceReference).toBe('GUD/022 §6.1')
    expect(auditLog).toHaveBeenCalled()
  })

  it('activateReportingRule refuses to activate a rule still marked unverified', async () => {
    const { service, reportingRule } = buildHarness()
    reportingRule.findUniqueOrThrow.mockResolvedValue({
      id: 'r1',
      status: 'draft',
      unverified: true,
    })

    await expect(service.activateReportingRule(actor, 'r1', {})).rejects.toMatchObject({
      response: { code: 'RULE_UNVERIFIED' },
    })
  })

  it('activateReportingRule refuses to activate a non-draft row', async () => {
    const { service, reportingRule } = buildHarness()
    reportingRule.findUniqueOrThrow.mockResolvedValue({
      id: 'r1',
      status: 'retired',
      unverified: false,
    })

    await expect(service.activateReportingRule(actor, 'r1', {})).rejects.toMatchObject({
      response: { code: 'NOT_DRAFT' },
    })
  })

  it('activateReportingRule maps a missing row to NOT_FOUND', async () => {
    const { service, reportingRule } = buildHarness()
    reportingRule.findUniqueOrThrow.mockRejectedValue(new Error('P2025'))

    await expect(service.activateReportingRule(actor, 'missing', {})).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })

  it('activateReportingRule retires the previously active version for the same natural key and audits both', async () => {
    const { service, reportingRule, auditLog } = buildHarness()
    const target = {
      id: 'r2',
      status: 'draft',
      unverified: false,
      authorityId: 'ppb',
      reportTypeId: 'adr',
      seriousnessClass: 'serious',
      version: 2,
    }
    const previousActive = { id: 'r1', version: 1 }
    reportingRule.findUniqueOrThrow.mockResolvedValue(target)
    reportingRule.findFirst.mockResolvedValue(previousActive)
    reportingRule.update.mockImplementation(({ where, data }) =>
      Promise.resolve({ id: where.id, ...data }),
    )

    const activated = await service.activateReportingRule(actor, 'r2', {})

    expect(reportingRule.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: 'retired' },
    })
    expect(reportingRule.update).toHaveBeenCalledWith({
      where: { id: 'r2' },
      data: { status: 'active' },
    })
    expect(activated.status).toBe('active')
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'reporting_rule_activated',
        oldValue: { activeVersionId: 'r1', version: 1 },
      }),
    )
  })

  it('activateReportingRule does not retire anything when no version was previously active', async () => {
    const { service, reportingRule, auditLog } = buildHarness()
    reportingRule.findUniqueOrThrow.mockResolvedValue({
      id: 'r1',
      status: 'draft',
      unverified: false,
      authorityId: 'ppb',
      reportTypeId: 'adr',
      seriousnessClass: 'serious',
      version: 1,
    })
    reportingRule.findFirst.mockResolvedValue(null)
    reportingRule.update.mockImplementation(({ where, data }) =>
      Promise.resolve({ id: where.id, ...data }),
    )

    await service.activateReportingRule(actor, 'r1', {})

    expect(reportingRule.update).toHaveBeenCalledTimes(1)
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ oldValue: undefined }),
    )
  })
})

describe('CountryConfigService — seriousness definitions', () => {
  it('creates at version 1, activates, and retires the previous active version', async () => {
    const { service, seriousnessDefinition, auditLog } = buildHarness()
    seriousnessDefinition.findFirst.mockResolvedValueOnce(null) // nextVersion lookup during create
    seriousnessDefinition.create.mockImplementation(({ data }) => Promise.resolve(data))

    const created = await service.createSeriousnessDefinitionVersion(
      actor,
      {
        authorityId: 'ppb',
        criterionKey: 'hospitalisation',
        label: 'Hospitalisation',
        effectiveFrom: '2026-01-01',
      },
      {},
    )
    expect(created.version).toBe(1)

    seriousnessDefinition.findUnique.mockResolvedValue({
      id: 'sd-2',
      status: 'draft',
      authorityId: 'ppb',
      criterionKey: 'hospitalisation',
      version: 2,
    })
    seriousnessDefinition.findFirst.mockResolvedValueOnce({ id: 'sd-1', version: 1 }) // previousActive lookup during activate
    seriousnessDefinition.update.mockImplementation(({ where, data }) =>
      Promise.resolve({ id: where.id, ...data }),
    )

    const activated = await service.activateSeriousnessDefinition(actor, 'sd-2', {})

    expect(seriousnessDefinition.update).toHaveBeenCalledWith({
      where: { id: 'sd-1' },
      data: { status: 'retired' },
    })
    expect(activated.status).toBe('active')
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'seriousness_definition_activated' }),
    )
  })

  it('refuses to activate a non-draft row', async () => {
    const { service, seriousnessDefinition } = buildHarness()
    seriousnessDefinition.findUnique.mockResolvedValue({ id: 'sd-1', status: 'active' })

    await expect(service.activateSeriousnessDefinition(actor, 'sd-1', {})).rejects.toMatchObject({
      response: { code: 'NOT_DRAFT' },
    })
  })

  it('maps a missing row to NOT_FOUND', async () => {
    const { service, seriousnessDefinition } = buildHarness()
    seriousnessDefinition.findUnique.mockResolvedValue(null)

    await expect(service.activateSeriousnessDefinition(actor, 'missing', {})).rejects.toMatchObject(
      {
        response: { code: 'NOT_FOUND' },
      },
    )
  })
})

describe('CountryConfigService — form schemas', () => {
  it('creates at version 1 and activation retires the previous active version for the same (country, reportType) key', async () => {
    const { service, formSchema, auditLog } = buildHarness()
    formSchema.findFirst.mockResolvedValueOnce(null)
    formSchema.create.mockImplementation(({ data }) => Promise.resolve(data))

    const created = await service.createFormSchemaVersion(
      actor,
      { reportTypeId: 'adr', jsonSchema: { sections: [] }, effectiveFrom: '2026-01-01' },
      {},
    )
    expect(created.version).toBe(1)
    expect(created.countryId).toBeNull()

    formSchema.findUnique.mockResolvedValue({
      id: 'fs-2',
      status: 'draft',
      countryId: null,
      reportTypeId: 'adr',
      version: 2,
    })
    formSchema.findFirst.mockResolvedValueOnce({ id: 'fs-1', version: 1 })
    formSchema.update.mockImplementation(({ where, data }) =>
      Promise.resolve({ id: where.id, ...data }),
    )

    const activated = await service.activateFormSchema(actor, 'fs-2', {})

    expect(formSchema.update).toHaveBeenCalledWith({
      where: { id: 'fs-1' },
      data: { status: 'retired' },
    })
    expect(activated.status).toBe('active')
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'form_schema_activated' }),
    )
  })

  it('refuses to activate a non-draft row', async () => {
    const { service, formSchema } = buildHarness()
    formSchema.findUnique.mockResolvedValue({ id: 'fs-1', status: 'retired' })

    await expect(service.activateFormSchema(actor, 'fs-1', {})).rejects.toMatchObject({
      response: { code: 'NOT_DRAFT' },
    })
  })
})

describe('CountryConfigService — submission formats', () => {
  it('creates at version 1 and activation retires the previous active version', async () => {
    const { service, submissionFormat, auditLog } = buildHarness()
    submissionFormat.findFirst.mockResolvedValueOnce(null)
    submissionFormat.create.mockImplementation(({ data }) => Promise.resolve(data))

    const created = await service.createSubmissionFormatVersion(
      actor,
      {
        authorityId: 'ppb',
        reportTypeId: 'adr',
        templateRef: 'E2B(R2)',
        channel: 'vigiflow',
        effectiveFrom: '2026-01-01',
      },
      {},
    )
    expect(created.version).toBe(1)

    submissionFormat.findUnique.mockResolvedValue({
      id: 'sf-2',
      status: 'draft',
      authorityId: 'ppb',
      reportTypeId: 'adr',
      version: 2,
    })
    submissionFormat.findFirst.mockResolvedValueOnce({ id: 'sf-1', version: 1 })
    submissionFormat.update.mockImplementation(({ where, data }) =>
      Promise.resolve({ id: where.id, ...data }),
    )

    const activated = await service.activateSubmissionFormat(actor, 'sf-2', {})

    expect(submissionFormat.update).toHaveBeenCalledWith({
      where: { id: 'sf-1' },
      data: { status: 'retired' },
    })
    expect(activated.status).toBe('active')
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'submission_format_activated' }),
    )
  })

  it('refuses to activate a non-draft row', async () => {
    const { service, submissionFormat } = buildHarness()
    submissionFormat.findUnique.mockResolvedValue({ id: 'sf-1', status: 'active' })

    await expect(service.activateSubmissionFormat(actor, 'sf-1', {})).rejects.toMatchObject({
      response: { code: 'NOT_DRAFT' },
    })
  })
})
