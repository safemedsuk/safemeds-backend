import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ClinicalTrialService } from './clinical-trial.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
  platformRole: null,
  tokenVersion: 1,
}
const platformActor: AuthenticatedUser = {
  sub: 'staff-1',
  companyId: null,
  roleKeys: [],
  platformRole: 'super_admin',
  tokenVersion: 1,
}

interface Row {
  id: string
  [key: string]: unknown
}

function createTable<T extends Row>() {
  const rows = new Map<string, T>()

  function matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true
      if (
        value !== null &&
        typeof value === 'object' &&
        'not' in (value as Record<string, unknown>)
      ) {
        return row[key] !== (value as { not: unknown }).not
      }
      if (
        value !== null &&
        typeof value === 'object' &&
        'contains' in (value as Record<string, unknown>)
      ) {
        const clause = value as { contains: string; mode?: string }
        const rowVal = typeof row[key] === 'string' ? row[key] : ''
        return clause.mode === 'insensitive'
          ? rowVal.toLowerCase().includes(clause.contains.toLowerCase())
          : rowVal.includes(clause.contains)
      }
      return row[key] === value
    })
  }

  const create = jest.fn().mockImplementation(({ data }: { data: T }) => {
    rows.set(data.id, { ...data })
    return Promise.resolve(rows.get(data.id))
  })
  const findFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].find((r) => matches(r, where)) ?? null),
    )
  const findUnique = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      // Composite-unique lookups (e.g. companyId_trialReference) come through as a nested object — flatten it into an equality filter.
      const flattened = Object.values(where)[0] as Record<string, unknown>
      return Promise.resolve([...rows.values()].find((r) => matches(r, flattened)) ?? null)
    })
  const findMany = jest
    .fn()
    .mockImplementation(
      ({
        where,
        skip,
        take,
        orderBy,
      }: {
        where?: Record<string, unknown>
        skip?: number
        take?: number
        orderBy?: Record<string, 'asc' | 'desc'>
      }) => {
        let list = [...rows.values()].filter((r) => matches(r, where ?? {}))
        if (orderBy) {
          const [field, dir] = Object.entries(orderBy)[0]
          list = list.sort((a, b) =>
            dir === 'desc'
              ? Number(b[field]) - Number(a[field])
              : Number(a[field]) - Number(b[field]),
          )
        }
        if (skip !== undefined || take !== undefined)
          list = list.slice(skip ?? 0, (skip ?? 0) + (take ?? list.length))
        return Promise.resolve(list)
      },
    )
  const count = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {})).length),
    )
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<T> }) => {
      const existing = rows.get(where.id)!
      const updated = { ...existing, ...data }
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    })

  return { rows, create, findFirst, findUnique, findMany, count, update }
}

function buildHarness(
  permissions: string[] = ['pv.manage_clinical_trials', 'pv.unblind_treatment'],
) {
  const tables = {
    clinicalTrial: createTable(),
    clinicalTrialSubject: createTable(),
    document: createTable(),
    case: { count: jest.fn().mockResolvedValue(0) },
    task: { findFirst: jest.fn().mockResolvedValue(null) },
  }
  tables.document.rows.set('doc-reg-approval', {
    id: 'doc-reg-approval',
    companyId: 'company-1',
  })
  tables.document.rows.set('doc-ethics-approval', {
    id: 'doc-ethics-approval',
    companyId: 'company-1',
  })

  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const getPermissionsForUser = jest.fn().mockResolvedValue(new Set(permissions))
  const rolesService = { getPermissionsForUser } as never
  const encrypt = jest.fn((plaintext: string) => `enc(${plaintext})`)
  const decrypt = jest.fn((ciphertext: string) =>
    ciphertext.replace(/^enc\(/, '').replace(/\)$/, ''),
  )
  const textEncryption = { encrypt, decrypt } as never
  const sign = jest.fn().mockResolvedValue({ id: 'signature-1' })
  const signatureService = { sign } as never

  const service = new ClinicalTrialService(
    rls as never,
    auditService,
    rolesService,
    textEncryption,
    signatureService,
  )
  return { service, tables, auditLog, encrypt, decrypt, sign, getPermissionsForUser }
}

function baseTrialDto(overrides: Partial<Parameters<ClinicalTrialService['create']>[1]> = {}) {
  return {
    trialReference: 'NCT-0001',
    trialName: 'A Study of Panadol in Adults',
    countryId: 'country-1',
    startDate: '2026-01-01',
    regulatoryApprovalDocumentId: 'doc-reg-approval',
    regulatoryApprovalDate: '2026-01-01',
    ethicsApprovalDocumentId: 'doc-ethics-approval',
    ethicsApprovalDate: '2026-01-01',
    ...overrides,
  }
}

describe('ClinicalTrialService', () => {
  describe('create()', () => {
    it('creates a trial and audits it', async () => {
      const { service, tables, auditLog } = buildHarness()
      const result = await service.create(actor, baseTrialDto(), {})

      expect(result.trialReference).toBe('NCT-0001')
      expect(tables.clinicalTrial.rows.size).toBe(1)
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'clinical_trial_created', recordId: result.id }),
      )
    })

    it('rejects a duplicate trialReference within the same company', async () => {
      const { service } = buildHarness()
      await service.create(actor, baseTrialDto(), {})
      await expect(service.create(actor, baseTrialDto(), {})).rejects.toThrow(ConflictException)
    })

    it('rejects a platform-staff actor with no company', async () => {
      const { service } = buildHarness()
      await expect(service.create(platformActor, baseTrialDto(), {})).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('real-usage request, 22 Sep 2026 (item 19) — rejects when the regulatory approval document does not exist for this company', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(actor, baseTrialDto({ regulatoryApprovalDocumentId: 'doc-nonexistent' }), {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('real-usage request, 22 Sep 2026 (item 19) — rejects when the ethics-committee approval document does not exist for this company', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(actor, baseTrialDto({ ethicsApprovalDocumentId: 'doc-nonexistent' }), {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('real-usage request, 22 Sep 2026 (item 19) — persists both approval documents/dates on the created trial', async () => {
      const { service } = buildHarness()
      const result = await service.create(
        actor,
        baseTrialDto({ regulatoryApprovalExpiryDate: '2027-01-01' }),
        {},
      )
      expect(result.regulatoryApprovalDocumentId).toBe('doc-reg-approval')
      expect(result.ethicsApprovalDocumentId).toBe('doc-ethics-approval')
      expect(result.regulatoryApprovalExpiryDate).toEqual(new Date('2027-01-01'))
    })
  })

  describe('renewApproval() (real-usage request, 22 Sep 2026, item 20)', () => {
    it('renews the regulatory approval as its own audited action', async () => {
      const { service, tables, auditLog } = buildHarness()
      const trial = await service.create(actor, baseTrialDto(), {})
      tables.document.rows.set('doc-reg-renewed', { id: 'doc-reg-renewed', companyId: 'company-1' })

      const updated = await service.renewApproval(
        actor,
        trial.id,
        { approvalType: 'regulatory', documentId: 'doc-reg-renewed', approvalDate: '2027-01-01' },
        {},
      )

      expect(updated.regulatoryApprovalDocumentId).toBe('doc-reg-renewed')
      expect(updated.regulatoryApprovalDate).toEqual(new Date('2027-01-01'))
      expect(updated.ethicsApprovalDocumentId).toBe('doc-ethics-approval') // untouched
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'clinical_trial_approval_renewed' }),
      )
    })

    it('renews the ethics-committee approval independently of the regulatory one', async () => {
      const { service, tables } = buildHarness()
      const trial = await service.create(actor, baseTrialDto(), {})
      tables.document.rows.set('doc-ethics-renewed', { id: 'doc-ethics-renewed', companyId: 'company-1' })

      const updated = await service.renewApproval(
        actor,
        trial.id,
        { approvalType: 'ethics', documentId: 'doc-ethics-renewed', approvalDate: '2027-06-01', expiryDate: '2028-06-01' },
        {},
      )

      expect(updated.ethicsApprovalDocumentId).toBe('doc-ethics-renewed')
      expect(updated.ethicsApprovalExpiryDate).toEqual(new Date('2028-06-01'))
      expect(updated.regulatoryApprovalDocumentId).toBe('doc-reg-approval') // untouched
    })

    it('404s on a nonexistent trial', async () => {
      const { service } = buildHarness()
      await expect(
        service.renewApproval(
          actor,
          'trial-nonexistent',
          { approvalType: 'regulatory', documentId: 'doc-reg-approval', approvalDate: '2027-01-01' },
          {},
        ),
      ).rejects.toThrow(NotFoundException)
    })

    it('rejects a renewal document that does not exist for this company', async () => {
      const { service } = buildHarness()
      const trial = await service.create(actor, baseTrialDto(), {})
      await expect(
        service.renewApproval(
          actor,
          trial.id,
          { approvalType: 'regulatory', documentId: 'doc-nonexistent', approvalDate: '2027-01-01' },
          {},
        ),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('approval status (real-usage request, 22 Sep 2026, items 19/20)', () => {
    it('flags "no_expiry" for an approval with a document but no expiry date', async () => {
      const { service } = buildHarness()
      const trial = await service.create(actor, baseTrialDto(), {})
      const fetched = await service.get(actor, trial.id)
      expect(fetched.regulatoryApprovalStatus).toBe('no_expiry')
      expect(fetched.ethicsApprovalStatus).toBe('no_expiry')
    })

    it('flags "expired" once the expiry date has passed, and "valid" for a far-future one', async () => {
      const { service } = buildHarness()
      const past = new Date()
      past.setFullYear(past.getFullYear() - 1)
      const farFuture = new Date()
      farFuture.setFullYear(farFuture.getFullYear() + 5)
      const trial = await service.create(
        actor,
        baseTrialDto({
          regulatoryApprovalExpiryDate: past.toISOString().slice(0, 10),
          ethicsApprovalExpiryDate: farFuture.toISOString().slice(0, 10),
        }),
        {},
      )
      const fetched = await service.get(actor, trial.id)
      expect(fetched.regulatoryApprovalStatus).toBe('expired')
      expect(fetched.ethicsApprovalStatus).toBe('valid')
    })
  })

  describe('enrollSubject()', () => {
    it('enrolls a subject and encrypts a provided treatment arm', async () => {
      const { service, tables, encrypt } = buildHarness()
      const trial = await service.create(actor, baseTrialDto(), {})

      const subject = await service.enrollSubject(
        actor,
        trial.id,
        { subjectCode: 'SUBJ-001', enrolledAt: '2026-02-01', treatmentArm: 'Arm A (active)' },
        {},
      )

      expect(encrypt).toHaveBeenCalledWith('Arm A (active)')
      expect((subject as unknown as Record<string, unknown>).treatmentArmEncrypted).toBeUndefined()
      expect(tables.clinicalTrialSubject.rows.get(subject.id)!.treatmentArmEncrypted).toBe(
        'enc(Arm A (active))',
      )
    })

    it('rejects a duplicate subjectCode within the same trial', async () => {
      const { service } = buildHarness()
      const trial = await service.create(actor, baseTrialDto(), {})
      await service.enrollSubject(
        actor,
        trial.id,
        { subjectCode: 'SUBJ-001', enrolledAt: '2026-02-01' },
        {},
      )
      await expect(
        service.enrollSubject(
          actor,
          trial.id,
          { subjectCode: 'SUBJ-001', enrolledAt: '2026-02-01' },
          {},
        ),
      ).rejects.toThrow(ConflictException)
    })

    it('404s for a trial that does not exist in this company', async () => {
      const { service } = buildHarness()
      await expect(
        service.enrollSubject(
          actor,
          'not-a-trial',
          { subjectCode: 'SUBJ-001', enrolledAt: '2026-02-01' },
          {},
        ),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('list()/get() read access', () => {
    it('allows a pv.capture_case holder to read even without pv.manage_clinical_trials', async () => {
      const { service } = buildHarness(['pv.capture_case'])
      const result = await service.list(actor, { page: 1, limit: 20 })
      expect(result.data).toEqual([])
    })

    it('rejects an actor with none of the qualifying permissions', async () => {
      const { service } = buildHarness([])
      await expect(service.list(actor, { page: 1, limit: 20 })).rejects.toThrow(ForbiddenException)
    })

    it('get() 404s for a trial in a different company', async () => {
      const { service, tables } = buildHarness()
      tables.clinicalTrial.rows.set('trial-1', { id: 'trial-1', companyId: 'a-different-company' })
      await expect(service.get(actor, 'trial-1')).rejects.toThrow(NotFoundException)
    })

    it('get() includes subjects with their secrets stripped', async () => {
      const { service } = buildHarness()
      const trial = await service.create(actor, baseTrialDto(), {})
      await service.enrollSubject(
        actor,
        trial.id,
        { subjectCode: 'SUBJ-001', enrolledAt: '2026-02-01', treatmentArm: 'Arm A' },
        {},
      )

      const found = await service.get(actor, trial.id)
      expect(found.subjects).toHaveLength(1)
      expect(
        (found.subjects[0] as unknown as Record<string, unknown>).treatmentArmEncrypted,
      ).toBeUndefined()
    })
  })

  describe('revealTreatmentArm()', () => {
    it('consumes a signature, decrypts the treatment arm, and marks the blind broken on first reveal', async () => {
      const { service, sign, auditLog } = buildHarness()
      const trial = await service.create(actor, baseTrialDto(), {})
      const subject = await service.enrollSubject(
        actor,
        trial.id,
        { subjectCode: 'SUBJ-001', enrolledAt: '2026-02-01', treatmentArm: 'Arm A (active)' },
        {},
      )

      const result = await service.revealTreatmentArm(
        actor,
        subject.id,
        {
          reason: 'Causality assessment',
          intentStatement: 'I confirm...',
          signatureToken: 'sig-token-1',
        },
        {},
      )

      expect(sign).toHaveBeenCalledWith(
        expect.anything(),
        actor,
        expect.objectContaining({
          recordType: 'clinical_trial_subject',
          recordId: subject.id,
          signatureToken: 'sig-token-1',
        }),
        {},
      )
      expect(result.treatmentArm).toBe('Arm A (active)')
      expect(result.blindingBroken).toBe(true)
      expect(result.unblindedAt).toBeInstanceOf(Date)
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'clinical_trial_subject_treatment_arm_revealed' }),
      )
    })

    it('does not overwrite the original unblinding actor/timestamp on a second reveal', async () => {
      const { service, tables } = buildHarness()
      const trial = await service.create(actor, baseTrialDto(), {})
      const subject = await service.enrollSubject(
        actor,
        trial.id,
        { subjectCode: 'SUBJ-001', enrolledAt: '2026-02-01', treatmentArm: 'Arm A' },
        {},
      )

      await service.revealTreatmentArm(
        actor,
        subject.id,
        { reason: 'First look', intentStatement: 'intent', signatureToken: 'sig-1' },
        {},
      )
      const firstUnblindedAt = tables.clinicalTrialSubject.rows.get(subject.id)!.unblindedAt

      const secondActor = { ...actor, sub: 'user-2' }
      await service.revealTreatmentArm(
        secondActor,
        subject.id,
        { reason: 'Second look', intentStatement: 'intent', signatureToken: 'sig-2' },
        {},
      )

      const row = tables.clinicalTrialSubject.rows.get(subject.id)!
      expect(row.unblindedBy).toBe('user-1')
      expect(row.unblindedAt).toEqual(firstUnblindedAt)
    })

    it('requires a fresh signature on every reveal, even after the blind is already broken', async () => {
      const { service, sign } = buildHarness()
      const trial = await service.create(actor, baseTrialDto(), {})
      const subject = await service.enrollSubject(
        actor,
        trial.id,
        { subjectCode: 'SUBJ-001', enrolledAt: '2026-02-01', treatmentArm: 'Arm A' },
        {},
      )

      await service.revealTreatmentArm(
        actor,
        subject.id,
        { reason: 'First', intentStatement: 'intent', signatureToken: 'sig-1' },
        {},
      )
      await service.revealTreatmentArm(
        actor,
        subject.id,
        { reason: 'Second', intentStatement: 'intent', signatureToken: 'sig-2' },
        {},
      )

      expect(sign).toHaveBeenCalledTimes(2)
    })

    it('404s for a subject that does not exist in this company', async () => {
      const { service } = buildHarness()
      await expect(
        service.revealTreatmentArm(
          actor,
          'not-a-subject',
          { reason: 'x', intentStatement: 'y', signatureToken: 'z' },
          {},
        ),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('findTrialByReference()', () => {
    it('resolves a trial by its human-readable reference, for the bulk importer', async () => {
      const { service } = buildHarness()
      const trial = await service.create(actor, baseTrialDto({ trialReference: 'NCT-9999' }), {})
      const found = await service.findTrialByReference(actor, 'NCT-9999')
      expect(found?.id).toBe(trial.id)
    })

    it('returns null for an unknown reference', async () => {
      const { service } = buildHarness()
      const found = await service.findTrialByReference(actor, 'NCT-DOES-NOT-EXIST')
      expect(found).toBeNull()
    })
  })
})
