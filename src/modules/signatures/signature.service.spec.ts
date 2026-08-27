import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { hashCanonicalPayload } from './canonical-hash.util'
import { SignatureService } from './signature.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const consume = jest.fn().mockResolvedValue(undefined)
  const signatureTokenService = { consume } as never
  const signatureEventCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const signatureEventFindMany = jest.fn()
  const signatureEventFindUnique = jest.fn()
  const prisma = {
    signatureEvent: { findMany: signatureEventFindMany, findUnique: signatureEventFindUnique },
  }

  const service = new SignatureService(prisma as never, auditService, signatureTokenService)
  return {
    service,
    auditLog,
    consume,
    signatureEventCreate,
    signatureEventFindMany,
    signatureEventFindUnique,
  }
}

describe('SignatureService.sign', () => {
  it('consumes the signature token, persists a hash + the canonical payload, and audits in the same transaction', async () => {
    const { service, consume, signatureEventCreate, auditLog } = buildHarness()
    const tx = { signatureEvent: { create: signatureEventCreate } } as never

    const created = await service.sign(
      tx,
      actor,
      {
        recordType: 'workflow_instance',
        recordId: 'instance-1',
        intentStatement: 'I approve',
        signatureToken: 'tok-123',
        roleAtSigning: 'QPPV',
        canonicalPayload: { a: 1, b: 2 },
      },
      { ip: '10.0.0.1' },
    )

    expect(consume).toHaveBeenCalledWith('tok-123', 'user-1')
    expect(created.companyId).toBe('company-1')
    expect(created.recordHashSha256).toEqual(expect.any(String))
    expect(created.canonicalPayload).toEqual({ a: 1, b: 2 })
    expect(auditLog).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'sign',
        recordType: 'workflow_instance',
        recordId: 'instance-1',
        ip: '10.0.0.1',
      }),
    )
  })

  it('produces the same hash for the same payload regardless of key order (stable canonicalization)', async () => {
    const { service, signatureEventCreate } = buildHarness()
    const tx = { signatureEvent: { create: signatureEventCreate } } as never

    const first = await service.sign(
      tx,
      actor,
      {
        recordType: 'x',
        recordId: 'r1',
        intentStatement: 'i',
        signatureToken: 't',
        roleAtSigning: 'QPPV',
        canonicalPayload: { a: 1, b: 2 },
      },
      {},
    )
    const second = await service.sign(
      tx,
      actor,
      {
        recordType: 'x',
        recordId: 'r1',
        intentStatement: 'i',
        signatureToken: 't',
        roleAtSigning: 'QPPV',
        canonicalPayload: { b: 2, a: 1 },
      },
      {},
    )

    expect(first.recordHashSha256).toBe(second.recordHashSha256)
  })

  it('refuses to sign for a platform (non-tenant-scoped) actor', async () => {
    const { service, signatureEventCreate } = buildHarness()
    const tx = { signatureEvent: { create: signatureEventCreate } } as never
    const platformActor: AuthenticatedUser = {
      sub: 'p1',
      companyId: null,
      roleKeys: [],
      platformRole: 'super_admin',
      tokenVersion: 1,
    }

    await expect(
      service.sign(
        tx,
        platformActor,
        {
          recordType: 'x',
          recordId: 'r1',
          intentStatement: 'i',
          signatureToken: 't',
          roleAtSigning: 'QPPV',
          canonicalPayload: {},
        },
        {},
      ),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } })
  })
})

describe('SignatureService.verify', () => {
  it('reports intact: true when the stored payload still hashes to the stored hash', async () => {
    const { service, signatureEventFindUnique } = buildHarness()
    signatureEventFindUnique.mockResolvedValue({
      id: 'sig-1',
      canonicalPayload: { a: 1 },
      recordHashSha256: hashCanonicalPayload({ a: 1 }),
      signedAt: new Date('2026-01-01'),
      signerId: 'user-1',
    })

    const result = await service.verify('sig-1')

    expect(result.intact).toBe(true)
  })

  it('reports intact: false when the stored hash no longer matches the stored payload (tampering)', async () => {
    const { service, signatureEventFindUnique } = buildHarness()
    signatureEventFindUnique.mockResolvedValue({
      id: 'sig-1',
      canonicalPayload: { a: 1, tampered: true },
      recordHashSha256: 'not-the-real-hash',
      signedAt: new Date('2026-01-01'),
      signerId: 'user-1',
    })

    const result = await service.verify('sig-1')

    expect(result.intact).toBe(false)
  })

  it('404s when the signature does not exist', async () => {
    const { service, signatureEventFindUnique } = buildHarness()
    signatureEventFindUnique.mockResolvedValue(null)

    await expect(service.verify('missing')).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })
})

describe('SignatureService.listForRecord', () => {
  it("scopes the query to the actor's own company", async () => {
    const { service, signatureEventFindMany } = buildHarness()
    signatureEventFindMany.mockResolvedValue([])

    await service.listForRecord(actor, 'workflow_instance', 'instance-1')

    expect(signatureEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { recordType: 'workflow_instance', recordId: 'instance-1', companyId: 'company-1' },
      }),
    )
  })

  it('refuses for a platform (non-tenant-scoped) actor', async () => {
    const { service } = buildHarness()
    const platformActor: AuthenticatedUser = {
      sub: 'p1',
      companyId: null,
      roleKeys: [],
      platformRole: 'super_admin',
      tokenVersion: 1,
    }

    await expect(service.listForRecord(platformActor, 'x', 'r1')).rejects.toMatchObject({
      response: { code: 'FORBIDDEN' },
    })
  })
})
