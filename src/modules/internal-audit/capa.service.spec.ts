import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CapaService } from './capa.service'
import { normalizeAllocation, resolveRootCauseCategory } from './capa-allocation'

/** Pass A2 — a small in-memory Prisma stand-in. Supports the where shapes CapaService/the allocation helper actually use. */
type Row = Record<string, unknown> & { id: string }

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected === undefined) return true
  if (
    expected !== null &&
    typeof expected === 'object' &&
    !(expected instanceof Date) &&
    !Array.isArray(expected)
  ) {
    const ops = expected as Record<string, unknown>
    if ('in' in ops) return (ops.in as unknown[]).includes(actual)
    if ('not' in ops)
      return ops.not === null ? actual !== null && actual !== undefined : actual !== ops.not
    if ('lt' in ops)
      return actual !== null && actual !== undefined && (actual as Date) < (ops.lt as Date)
    if ('gte' in ops)
      return actual !== null && actual !== undefined && (actual as Date) >= (ops.gte as Date)
    if ('hasSome' in ops)
      return (actual as string[]).some((v) => (ops.hasSome as string[]).includes(v))
    if ('some' in ops) return false
    if ('has' in ops) return Array.isArray(actual) && actual.includes(ops.has)
  }
  if (expected instanceof Date) return (actual as Date)?.getTime() === expected.getTime()
  return actual === expected
}

function matches(row: Row, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return (value as Record<string, unknown>[]).some((w) => matches(row, w))
    if (key === 'AND') return (value as Record<string, unknown>[]).every((w) => matches(row, w))
    return matchesValue(row[key], value)
  })
}

function createTable(defaults: Partial<Row> = {}) {
  const rows = new Map<string, Row>()
  return {
    rows,
    create: jest.fn(({ data }: { data: Row }) => {
      const row = { ...defaults, ...data } as Row
      rows.set(row.id, row)
      return Promise.resolve(row)
    }),
    findFirst: jest.fn(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].find((r) => matches(r, where)) ?? null),
    ),
    findMany: jest.fn(({ where }: { where?: Record<string, unknown> } = {}) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where))),
    ),
    count: jest.fn(({ where }: { where?: Record<string, unknown> } = {}) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where)).length),
    ),
    update: jest.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const existing = rows.get(where.id)!
      const cleaned = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
      const updated = { ...existing, ...cleaned } as Row
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    }),
  }
}

/** Runs `fn` and asserts it throws a `BadRequestException` carrying the given stable `code`. */
function expectRuleCode(fn: () => unknown, code: string): void {
  let thrown: unknown
  try {
    fn()
  } catch (err) {
    thrown = err
  }
  expect(thrown).toBeInstanceOf(BadRequestException)
  expect((thrown as BadRequestException).getResponse()).toMatchObject({ code })
}

const COMPANY = 'company-1'

/** Permission grants per user id, as `RolesService.getPermissionsForUser` would resolve them. */
const PERMISSIONS: Record<string, string[]> = {
  manager: ['quality.manage_capa', 'quality.close_capa', 'quality.view_all'],
  associate: ['quality.manage_capa', 'quality.view_all'],
  'owner-user': ['quality.manage_capa'],
  'reg-approver': ['regulatory.manage_registrations'],
  outsider: [],
}

function actorFor(sub: string): AuthenticatedUser {
  return { sub, companyId: COMPANY, roleKeys: [], platformRole: null, tokenVersion: 1 }
}

const ROLE_FOR_PERMISSION: Record<string, string> = {
  'quality.manage_capa': 'QUALITY_ASSOCIATE',
  'regulatory.manage_registrations': 'REGULATORY_AFFAIRS_OFFICER',
}

function buildHarness() {
  const tables = {
    capa: createTable({
      status: 'open',
      flaggedRecurring: false,
      requiresRegulatoryApproval: false,
    }),
    auditFinding: createTable({ status: 'open' }),
    document: createTable(),
    user: createTable(),
    role: {
      findMany: jest.fn(
        ({ where }: { where: { permissions: { some: { permission: { key: string } } } } }) => {
          const key = where.permissions.some.permission.key
          const role = ROLE_FOR_PERMISSION[key]
          return Promise.resolve(role ? [{ key: role }] : [])
        },
      ),
    },
  }
  // Users: owner, associate-manager, reg approver, outsider — all active, company-scoped.
  const people: [string, string[]][] = [
    ['manager', ['QUALITY_MANAGER']],
    ['associate', ['QUALITY_ASSOCIATE']],
    ['owner-user', ['QUALITY_ASSOCIATE']],
    ['reg-approver', ['REGULATORY_AFFAIRS_OFFICER']],
    ['outsider', ['EXECUTIVE_READONLY']],
  ]
  for (const [id, roleKeys] of people) {
    tables.user.rows.set(id, {
      id,
      companyId: COMPANY,
      status: 'active',
      roleKeys,
      fullName: `Name ${id}`,
      email: `${id}@x.test`,
    })
  }

  const tx = tables
  const rls = {
    runAsCompany: (_companyId: string, fn: (t: typeof tx) => unknown) => fn(tx),
    runWithSystemAccess: (fn: (t: typeof tx) => unknown) => fn(tx),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const escalateForRecord = jest.fn().mockResolvedValue(undefined)
  const tasksService = { escalateForRecord } as never
  const rolesService = {
    getPermissionsForUser: jest.fn((u: AuthenticatedUser) =>
      Promise.resolve(new Set(PERMISSIONS[u.sub] ?? [])),
    ),
  } as never
  const documentsService = {
    uploadDirect: jest.fn().mockResolvedValue({ document: { id: 'doc-1' }, version: {} }),
  } as never

  const service = new CapaService(
    rls as never,
    auditService,
    tasksService,
    rolesService,
    documentsService,
  )
  return { service, tables, auditLog, escalateForRecord, documentsService }
}

const validAllocation = {
  rootCause: 'Operator skipped the line clearance step',
  rootCauseCategory: 'human_error_training',
  correctiveAction: 'Retrain operator and re-perform line clearance',
  preventiveAction: 'Add a line-clearance sign-off to the batch record',
  ownerUserId: 'owner-user',
  correctiveActionDueDate: '2026-12-01',
  preventiveActionDueDate: '2027-01-15',
}

describe('normalizeAllocation() — pure Pass A2 allocation rules', () => {
  it('derives the title from the root cause and mirrors the legacy dueDate', () => {
    const n = normalizeAllocation(validAllocation)
    expect(n.title).toBe(validAllocation.rootCause)
    expect(n.dueDate).toEqual(n.correctiveActionDueDate)
    expect(n.preventiveActionDueDate?.toISOString().slice(0, 10)).toBe('2027-01-15')
  })

  it('rejects an empty root cause', () => {
    expect(() => normalizeAllocation({ ...validAllocation, rootCause: '   ' })).toThrow(
      BadRequestException,
    )
  })

  it('stores typed free text when "other" is chosen, and rejects an empty "other"', () => {
    expect(resolveRootCauseCategory('other', '  Vendor portal outage  ')).toBe(
      'Vendor portal outage',
    )
    expect(() => resolveRootCauseCategory('other', '')).toThrow(BadRequestException)
  })

  it('rejects a category that is neither a listed key nor "other"', () => {
    expect(() => resolveRootCauseCategory('made_up', undefined)).toThrow(BadRequestException)
  })

  it('requires a preventive due date whenever a preventive action is given', () => {
    expectRuleCode(
      () => normalizeAllocation({ ...validAllocation, preventiveActionDueDate: undefined }),
      'PREVENTIVE_DUE_DATE_REQUIRED',
    )
  })

  it('does not require a preventive due date when there is no preventive action', () => {
    const n = normalizeAllocation({
      ...validAllocation,
      preventiveAction: undefined,
      preventiveActionDueDate: undefined,
    })
    expect(n.preventiveActionDueDate).toBeNull()
  })

  it('requires a regulatory approver whenever regulatory approval is needed', () => {
    expectRuleCode(
      () => normalizeAllocation({ ...validAllocation, requiresRegulatoryApproval: true }),
      'REGULATORY_APPROVER_REQUIRED',
    )
  })
})

describe('CapaService', () => {
  describe('create()', () => {
    it('opens a fully allocated CAPA and writes an allocation audit entry', async () => {
      const { service, tables, auditLog } = buildHarness()
      const capa = await service.create(actorFor('manager'), validAllocation, {})
      expect(capa.title).toBe(validAllocation.rootCause)
      expect(capa.ownerUserId).toBe('owner-user')
      expect(capa.status).toBe('open')
      expect(tables.capa.rows.get(capa.id)!.correctiveActionDueDate).toBeInstanceOf(Date)
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'capa_opened' }),
      )
    })

    it('refuses an owner who does not hold quality.manage_capa', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(actorFor('manager'), { ...validAllocation, ownerUserId: 'outsider' }, {}),
      ).rejects.toMatchObject({ response: { code: 'OWNER_NOT_QUALIFIED' } })
    })

    it('designates a regulatory approver and audits it, when one is required', async () => {
      const { service, auditLog } = buildHarness()
      const capa = await service.create(
        actorFor('manager'),
        {
          ...validAllocation,
          requiresRegulatoryApproval: true,
          regulatoryApproverUserId: 'reg-approver',
        },
        {},
      )
      expect(capa.regulatoryApproverUserId).toBe('reg-approver')
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'capa_regulatory_approver_assigned' }),
      )
    })

    it('refuses a regulatory approver who lacks regulatory.manage_registrations', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(
          actorFor('manager'),
          {
            ...validAllocation,
            requiresRegulatoryApproval: true,
            regulatoryApproverUserId: 'owner-user',
          },
          {},
        ),
      ).rejects.toMatchObject({ response: { code: 'REGULATORY_APPROVER_NOT_QUALIFIED' } })
    })

    it('links to a real finding and flips it to capa_assigned', async () => {
      const { service, tables } = buildHarness()
      tables.auditFinding.rows.set('finding-1', {
        id: 'finding-1',
        companyId: COMPANY,
        status: 'open',
      })
      const capa = await service.create(
        actorFor('manager'),
        { ...validAllocation, findingId: 'finding-1' },
        {},
      )
      expect(capa.findingId).toBe('finding-1')
      expect(capa.sourceRecordType).toBe('audit_finding')
      expect(tables.auditFinding.rows.get('finding-1')!.status).toBe('capa_assigned')
    })

    it('404s when the finding does not exist', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(actorFor('manager'), { ...validAllocation, findingId: 'nope' }, {}),
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('rejects a company-less actor', async () => {
      const { service } = buildHarness()
      await expect(
        service.create({ ...actorFor('manager'), companyId: null }, validAllocation, {}),
      ).rejects.toBeInstanceOf(ForbiddenException)
    })
  })

  describe('visibility — who can see a CAPA', () => {
    async function seed() {
      const harness = buildHarness()
      const capa = await harness.service.create(actorFor('manager'), validAllocation, {})
      return { ...harness, capaId: capa.id }
    }

    it('managers (quality.view_all / manage_capa) see every CAPA, unchanged', async () => {
      const { service, capaId } = await seed()
      await expect(service.get(actorFor('manager'), capaId)).resolves.toMatchObject({ id: capaId })
      await expect(service.get(actorFor('associate'), capaId)).resolves.toMatchObject({
        id: capaId,
      })
    })

    it('a non-manager participant (the owner) can see their own CAPA', async () => {
      const { service, capaId } = await seed()
      await expect(service.get(actorFor('owner-user'), capaId)).resolves.toMatchObject({
        id: capaId,
      })
    })

    it('a non-manager outsider gets a 404 — existence is not revealed', async () => {
      const { service, capaId } = await seed()
      await expect(service.get(actorFor('outsider'), capaId)).rejects.toBeInstanceOf(
        NotFoundException,
      )
    })

    it('list() for a non-manager returns only CAPAs they are a participant on', async () => {
      const { service, capaId } = await seed()
      const mine = await service.list(actorFor('outsider'), { page: 1, limit: 20 })
      expect(mine.data).toHaveLength(0)
      const owned = await service.list(actorFor('owner-user'), { page: 1, limit: 20 })
      expect(owned.data.map((c) => c.id)).toEqual([capaId])
    })
  })

  describe('actions — assignee and manager rules', () => {
    it('a non-participant non-manager cannot update a CAPA (404: not visible to them at all)', async () => {
      const h = buildHarness()
      const capa = await h.service.create(actorFor('manager'), validAllocation, {})
      await expect(
        h.service.update(actorFor('outsider'), capa.id, { correctiveAction: 'hijack' }, {}),
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('the assignee can update their own CAPA (manage_capa held)', async () => {
      const h = buildHarness()
      const capa = await h.service.create(actorFor('manager'), validAllocation, {})
      const updated = await h.service.update(
        actorFor('owner-user'),
        capa.id,
        { correctiveAction: 'Revised corrective action wording' },
        {},
      )
      expect(updated.correctiveAction).toBe('Revised corrective action wording')
    })

    it('reassigning the owner writes a capa_owner_reassigned audit entry and validates the new owner', async () => {
      const h = buildHarness()
      const capa = await h.service.create(actorFor('manager'), validAllocation, {})
      await h.service.update(actorFor('manager'), capa.id, { ownerUserId: 'associate' }, {})
      expect(h.auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'capa_owner_reassigned' }),
      )
      await expect(
        h.service.update(actorFor('manager'), capa.id, { ownerUserId: 'outsider' }, {}),
      ).rejects.toMatchObject({ response: { code: 'OWNER_NOT_QUALIFIED' } })
    })

    it('a participant who is neither creator, owner nor manager cannot reassign the owner', async () => {
      const h = buildHarness()
      const capa = await h.service.create(
        actorFor('manager'),
        {
          ...validAllocation,
          requiresRegulatoryApproval: true,
          regulatoryApproverUserId: 'reg-approver',
        },
        {},
      )
      // reg-approver can see the CAPA (designated approver) but lacks manage_capa, so may not reassign the owner.
      await expect(
        h.service.update(actorFor('reg-approver'), capa.id, { ownerUserId: 'associate' }, {}),
      ).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('audits a due-date change with the old and new dates', async () => {
      const h = buildHarness()
      const capa = await h.service.create(actorFor('manager'), validAllocation, {})
      await h.service.update(
        actorFor('manager'),
        capa.id,
        { correctiveActionDueDate: '2027-03-01' },
        {},
      )
      expect(h.auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'capa_due_dates_changed' }),
      )
    })

    it('reassigns the regulatory approver with a reassignment audit entry', async () => {
      const h = buildHarness()
      const capa = await h.service.create(
        actorFor('manager'),
        {
          ...validAllocation,
          requiresRegulatoryApproval: true,
          regulatoryApproverUserId: 'reg-approver',
        },
        {},
      )
      h.tables.user.rows.set('reg-2', {
        id: 'reg-2',
        companyId: COMPANY,
        status: 'active',
        roleKeys: ['REGULATORY_AFFAIRS_OFFICER'],
        fullName: 'Reg Two',
        email: 'r2@x.test',
      })
      await h.service.reassignRegulatoryApprover(
        actorFor('owner-user'),
        capa.id,
        { regulatoryApproverUserId: 'reg-2' },
        {},
      )
      expect(h.auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'capa_regulatory_approver_reassigned' }),
      )
    })
  })

  describe('close() — evidence gate', () => {
    async function readyToClose() {
      const h = buildHarness()
      const capa = await h.service.create(actorFor('manager'), validAllocation, {})
      h.tables.capa.rows.set(capa.id, {
        ...h.tables.capa.rows.get(capa.id)!,
        approvedAt: new Date(),
        effectivenessCheckResult: 'effective',
      })
      return { ...h, capaId: capa.id }
    }

    it('refuses to close with no attached evidence', async () => {
      const { service, capaId } = await readyToClose()
      await expect(service.close(actorFor('manager'), capaId, {})).rejects.toMatchObject({
        response: { code: 'EVIDENCE_REQUIRED' },
      })
    })

    it('closes once evidence is attached, and audits the evidence count', async () => {
      const { service, tables, capaId, auditLog } = await readyToClose()
      tables.document.rows.set('doc-1', {
        id: 'doc-1',
        companyId: COMPANY,
        recordType: 'capa',
        recordId: capaId,
      })
      const closed = await service.close(actorFor('manager'), capaId, {})
      expect(closed.status).toBe('closed')
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'capa_closed',
          newValue: expect.objectContaining({ evidenceDocumentCount: 1 }),
        }),
      )
    })

    it('uploadEvidence() attaches through the documents path and audits it', async () => {
      const { service, documentsService, auditLog, capaId } = await readyToClose()
      await service.uploadEvidence(
        actorFor('owner-user'),
        capaId,
        { buffer: Buffer.from('x'), originalname: 'photo.jpg', mimetype: 'image/jpeg' },
        {},
      )
      expect(
        (documentsService as unknown as { uploadDirect: jest.Mock }).uploadDirect,
      ).toHaveBeenCalledWith(
        expect.anything(),
        'capa',
        capaId,
        expect.anything(),
        expect.anything(),
        expect.anything(),
      )
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'capa_evidence_attached' }),
      )
    })

    it('refuses to close while the regulatory approval is still outstanding', async () => {
      const h = buildHarness()
      const capa = await h.service.create(
        actorFor('manager'),
        {
          ...validAllocation,
          requiresRegulatoryApproval: true,
          regulatoryApproverUserId: 'reg-approver',
        },
        {},
      )
      h.tables.capa.rows.set(capa.id, {
        ...h.tables.capa.rows.get(capa.id)!,
        effectivenessCheckResult: 'effective',
      })
      h.tables.document.rows.set('doc-1', {
        id: 'doc-1',
        companyId: COMPANY,
        recordType: 'capa',
        recordId: capa.id,
      })
      await expect(h.service.close(actorFor('manager'), capa.id, {})).rejects.toMatchObject({
        response: { code: 'REGULATORY_APPROVAL_REQUIRED' },
      })
    })
  })

  describe('approve() / regulatoryApprove() — the regulatory approver', () => {
    it('approve() refuses a required regulatory approver that was never designated', async () => {
      const h = buildHarness()
      const capa = await h.service.create(actorFor('manager'), validAllocation, {})
      h.tables.capa.rows.set(capa.id, {
        ...h.tables.capa.rows.get(capa.id)!,
        requiresRegulatoryApproval: true,
      })
      await expect(h.service.approve(actorFor('manager'), capa.id, {}, {})).rejects.toMatchObject({
        response: { code: 'REGULATORY_APPROVER_REQUIRED' },
      })
    })

    it('regulatoryApprove() is allowed only for the designated approver (or a manager)', async () => {
      const h = buildHarness()
      const capa = await h.service.create(
        actorFor('manager'),
        {
          ...validAllocation,
          requiresRegulatoryApproval: true,
          regulatoryApproverUserId: 'reg-approver',
        },
        {},
      )
      h.tables.user.rows.set('reg-2', {
        id: 'reg-2',
        companyId: COMPANY,
        status: 'active',
        roleKeys: ['REGULATORY_AFFAIRS_OFFICER'],
        fullName: 'Reg Two',
        email: 'r2@x.test',
      })
      PERMISSIONS['reg-2'] = ['regulatory.manage_registrations']
      await expect(
        h.service.regulatoryApprove(actorFor('reg-2'), capa.id, {}),
      ).rejects.toBeInstanceOf(ForbiddenException)
      await expect(
        h.service.regulatoryApprove(actorFor('reg-approver'), capa.id, {}),
      ).resolves.toMatchObject({
        regulatoryApprovedBy: 'reg-approver',
      })
    })
  })

  describe('createFrom() — legacy system-originated path', () => {
    it('still opens a CAPA without an owner (documented gap for recall/PQR/management-review callers)', async () => {
      const h = buildHarness()
      const capa = await h.service.createFrom(
        h.tables as never,
        actorFor('manager'),
        COMPANY,
        'pqr_action',
        'pqr-1',
        { title: 'PQR action', correctiveAction: 'Do the thing' },
        {},
      )
      expect(capa.sourceRecordType).toBe('pqr_action')
      expect(capa.ownerUserId).toBeNull()
    })
  })

  describe('reopen-on-recurrence — QualCloud Stage 3', () => {
    it('flags a prior effective CAPA when a new CAPA shares its root-cause category', async () => {
      const h = buildHarness()
      const prior = await h.service.create(actorFor('manager'), validAllocation, {})
      h.tables.capa.rows.set(prior.id, {
        ...h.tables.capa.rows.get(prior.id)!,
        status: 'closed',
        effectivenessCheckResult: 'effective',
        closedAt: new Date(),
      })
      await h.service.create(
        actorFor('manager'),
        { ...validAllocation, rootCause: 'Another occurrence' },
        {},
      )
      expect(h.tables.capa.rows.get(prior.id)!.flaggedRecurring).toBe(true)
    })
  })

  describe('escalateOverdue() — either due date', () => {
    it('escalates a CAPA whose preventive action date has passed even if the corrective date has not', async () => {
      const h = buildHarness()
      const capa = await h.service.create(actorFor('manager'), validAllocation, {})
      h.tables.capa.rows.set(capa.id, {
        ...h.tables.capa.rows.get(capa.id)!,
        correctiveActionDueDate: new Date('2099-01-01'),
        preventiveActionDueDate: new Date('2000-01-01'),
      })
      const result = await h.service.escalateOverdue()
      expect(result.capasEscalated).toBe(1)
    })
  })
})

// Silence unused-import lint on helpers used only by some tests.
void ConflictException
