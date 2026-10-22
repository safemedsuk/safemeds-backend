import { ConflictException } from '@nestjs/common'

import {
  buildDocumentNumber,
  companyPrefix,
  DocumentNumberingService,
  documentTypePrefix,
  formatDocumentNumber,
  isValidInitials,
  resolveScheme,
  SchemeRow,
  validateManualDocumentNumber,
} from './document-numbering.service'

const COMPANY_ID = '00000000-0000-4000-8000-000000000001'

describe('document numbering — default scheme (Pass A, unchanged)', () => {
  it('derives company initials, ignoring legal suffixes', () => {
    expect(companyPrefix('Acme Pharma Ltd')).toBe('AP')
    expect(companyPrefix('SafeMeds Inc.')).toBe('SAF')
    expect(companyPrefix('Kenya Medical Supplies Limited')).toBe('KMS')
    expect(companyPrefix('   ')).toBe('CO')
  })

  it('derives type initials, falling back to three letters for single words', () => {
    expect(documentTypePrefix('work_instruction')).toBe('WI')
    expect(documentTypePrefix('master_batch_record')).toBe('MBR')
    expect(documentTypePrefix('sop')).toBe('SOP')
    expect(documentTypePrefix('policy')).toBe('POL')
  })

  it('formatDocumentNumber keeps the Pass A shape', () => {
    expect(formatDocumentNumber('AP', 'SOP', 2026, 1)).toBe('AP-SOP-2026-0001')
  })

  it('a company with no scheme rows gets the default order and separator', () => {
    const s = resolveScheme([], 'Acme Pharma Ltd', 'sop')
    expect(s.tokenOrder).toEqual(['company', 'type', 'year', 'sequence'])
    expect(s.separator).toBe('-')
    expect(s.companyInitialsIsDefault).toBe(true)
    expect(buildDocumentNumber(s, 2026, 1)).toBe('AP-SOP-2026-0001')
  })
})

describe('document numbering — configurable scheme', () => {
  const company: SchemeRow = {
    scope: 'company',
    initials: 'WHO',
    tokenOrder: ['company', 'type', 'year', 'sequence'],
    separator: '-',
  }

  it('builds COMPANY-DOCINITIAL-YYYY-0001 from configured initials', () => {
    const rows: SchemeRow[] = [
      company,
      { scope: 'sop', initials: 'SOP', tokenOrder: null, separator: null },
    ]
    expect(buildDocumentNumber(resolveScheme(rows, 'Acme', 'sop'), 2026, 1)).toBe(
      'WHO-SOP-2026-0001',
    )
  })

  it('supports the reversed order YYYY-0001-DOCINITIAL-COMPANY with a custom separator', () => {
    const rows: SchemeRow[] = [
      { ...company, tokenOrder: ['year', 'sequence', 'type', 'company'], separator: '/' },
      { scope: 'policy', initials: 'POL', tokenOrder: null, separator: null },
    ]
    expect(buildDocumentNumber(resolveScheme(rows, 'Acme', 'policy'), 2026, 12)).toBe(
      '2026/0012/POL/WHO',
    )
  })

  it('a type row with its own order overrides the company default; a null row inherits it', () => {
    const rows: SchemeRow[] = [
      company,
      {
        scope: 'form',
        initials: 'FRM',
        tokenOrder: ['sequence', 'year', 'type', 'company'],
        separator: '.',
      },
      { scope: 'sop', initials: 'SOP', tokenOrder: null, separator: null },
    ]
    const form = resolveScheme(rows, 'Acme', 'form')
    const sop = resolveScheme(rows, 'Acme', 'sop')
    expect(form.ownScheme).toBe(true)
    expect(buildDocumentNumber(form, 2026, 3)).toBe('0003.2026.FRM.WHO')
    expect(sop.ownScheme).toBe(false)
    expect(buildDocumentNumber(sop, 2026, 3)).toBe('WHO-SOP-2026-0003')
  })

  it('ignores a corrupt stored token order and falls back to the default', () => {
    const rows: SchemeRow[] = [
      { ...company, tokenOrder: ['company', 'company', 'year', 'sequence'] },
    ]
    expect(resolveScheme(rows, 'Acme', 'sop').tokenOrder).toEqual([
      'company',
      'type',
      'year',
      'sequence',
    ])
  })

  it('initials must be 1 to 10 letters or digits (no separator characters, so numbers stay unambiguous)', () => {
    expect(isValidInitials('WHO')).toBe(true)
    expect(isValidInitials('A1')).toBe(true)
    expect(isValidInitials('WH-O')).toBe(false)
    expect(isValidInitials('')).toBe(false)
    expect(isValidInitials('ABCDEFGHIJK')).toBe(false)
  })
})

describe('manual document numbers', () => {
  it('rejects a digits-only value with an explanation of the 0001 consequence', () => {
    try {
      validateManualDocumentNumber(' 0001 ')
      fail('expected rejection')
    } catch (err) {
      const body = (err as { getResponse: () => { code: string; message: string } }).getResponse()
      expect(body.code).toBe('DOCUMENT_NUMBER_NUMERIC_ONLY')
      expect(body.message).toContain('0001')
    }
  })

  it('rejects an empty value and accepts a trimmed identifier', () => {
    expect(() => validateManualDocumentNumber('   ')).toThrow()
    expect(validateManualDocumentNumber('  WHO-SOP-0001 ')).toBe('WHO-SOP-0001')
  })

  it('rejects characters outside the identifier set', () => {
    expect(() => validateManualDocumentNumber('SOP 01!')).toThrow()
  })

  it('reserveManual() refuses a case-insensitive duplicate and never touches the sequence', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: '' }]),
      documentNumberSequence: { findUnique: jest.fn() },
    }
    const service = new DocumentNumberingService({} as never, {} as never)
    await expect(
      service.reserveManual(tx as never, COMPANY_ID, 'who-sop-0001', () => Promise.resolve(true)),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(tx.documentNumberSequence.findUnique).not.toHaveBeenCalled()
  })

  it('reserveManual() returns the trimmed value when free', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ locked: '' }]) }
    const service = new DocumentNumberingService({} as never, {} as never)
    await expect(
      service.reserveManual(tx as never, COMPANY_ID, ' ACME-POL-7 ', () => Promise.resolve(false)),
    ).resolves.toBe('ACME-POL-7')
  })
})

describe('DocumentNumberingService.allocate()', () => {
  it('increments the atomic sequence and formats with the company scheme', async () => {
    const tx = {
      company: {},
      documentNumberingScheme: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { scope: 'company', initials: 'WHO', tokenOrder: null, separator: null },
          ]),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ last_value: 3 }]) // sequence upsert
        .mockResolvedValueOnce([{ locked: '' }]), // advisory lock
    }
    const service = new DocumentNumberingService({} as never, {} as never)
    const number = await service.allocate(tx as never, {
      companyId: COMPANY_ID,
      companyName: 'Acme Pharma Ltd',
      documentType: 'sop',
      now: new Date('2026-06-01T00:00:00Z'),
    })
    expect(number).toBe('WHO-SOP-2026-0003')
  })

  it('skips a candidate that is already taken and keeps advancing (never re-issues)', async () => {
    const tx = {
      documentNumberingScheme: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ last_value: 1 }])
        .mockResolvedValueOnce([{ locked: '' }])
        .mockResolvedValueOnce([{ last_value: 2 }])
        .mockResolvedValueOnce([{ locked: '' }]),
    }
    const isTaken = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const service = new DocumentNumberingService({} as never, {} as never)
    const number = await service.allocate(tx as never, {
      companyId: COMPANY_ID,
      companyName: 'Acme Pharma Ltd',
      documentType: 'sop',
      now: new Date('2026-06-01T00:00:00Z'),
      isTaken,
    })
    expect(number).toBe('AP-SOP-2026-0002')
    expect(isTaken).toHaveBeenCalledTimes(2)
  })
})
