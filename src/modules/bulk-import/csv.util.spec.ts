import { parseCsv, parseCsvToObjects } from './csv.util'

describe('parseCsv', () => {
  it('parses a simple comma-separated table', () => {
    expect(parseCsv('a,b,c\n1,2,3\n4,5,6')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ])
  })

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('handles a quoted field containing a comma', () => {
    expect(parseCsv('email,roleKeys\njeff@example.com,"QPPV,QUALITY_MANAGER"')).toEqual([
      ['email', 'roleKeys'],
      ['jeff@example.com', 'QPPV,QUALITY_MANAGER'],
    ])
  })

  it('handles a quoted field containing an embedded newline', () => {
    expect(parseCsv('note\n"line one\nline two"')).toEqual([['note'], ['line one\nline two']])
  })

  it('handles doubled-quote escaping inside a quoted field', () => {
    expect(parseCsv('note\n"she said ""hello"""')).toEqual([['note'], ['she said "hello"']])
  })

  it('handles a file with no trailing newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('returns an empty array for an empty string', () => {
    expect(parseCsv('')).toEqual([])
  })
})

describe('parseCsvToObjects', () => {
  it('maps each data row to an object keyed by the trimmed header row', () => {
    const result = parseCsvToObjects(
      ' email , roleKeys \njeff@example.com,QPPV\nrobert@example.com,SUPERINTENDENT_PHARMACIST',
    )
    expect(result.headers).toEqual(['email', 'roleKeys'])
    expect(result.rows).toEqual([
      { email: 'jeff@example.com', roleKeys: 'QPPV' },
      { email: 'robert@example.com', roleKeys: 'SUPERINTENDENT_PHARMACIST' },
    ])
  })

  it('trims whitespace on every value', () => {
    const result = parseCsvToObjects('email,roleKeys\n  jeff@example.com  ,  QPPV  ')
    expect(result.rows[0]).toEqual({ email: 'jeff@example.com', roleKeys: 'QPPV' })
  })

  it('fills a missing trailing column with an empty string rather than throwing', () => {
    const result = parseCsvToObjects('email,roleKeys\njeff@example.com')
    expect(result.rows[0]).toEqual({ email: 'jeff@example.com', roleKeys: '' })
  })

  it('returns empty headers/rows for an empty input', () => {
    expect(parseCsvToObjects('')).toEqual({ headers: [], rows: [] })
  })
})
