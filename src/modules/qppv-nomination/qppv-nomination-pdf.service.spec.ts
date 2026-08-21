import { QppvNominationPdfService } from './qppv-nomination-pdf.service'

describe('QppvNominationPdfService.render()', () => {
  const service = new QppvNominationPdfService()

  it('renders a real, non-empty PDF for a primary nomination with no counterpart yet', async () => {
    const buffer = await service.render({
      companyName: 'Nairobi Vigil Labs',
      registeredAddress: '123 Main St, Nairobi',
      regulatoryContactEmail: 'pv@nairobivigil.example',
      qppvFullName: 'Dr. Jane Wanjiru',
      qppvEmail: 'jane.wanjiru@nairobivigil.example',
      role: 'primary',
      nominatedAt: new Date('2026-08-19'),
      counterpart: null,
    })

    expect(buffer.length).toBeGreaterThan(1000)
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  // Real-usage feedback, 19 Aug 2026 — rebuilt against the real sample
  // template's §4 "Backup / Deputy QPPV Details" — a primary letter
  // should reference the already-appointed backup when one exists.
  it('renders successfully for a primary nomination with a known backup counterpart', async () => {
    const buffer = await service.render({
      companyName: 'Nairobi Vigil Labs',
      registeredAddress: '123 Main St, Nairobi',
      regulatoryContactEmail: 'pv@nairobivigil.example',
      qppvFullName: 'Dr. Jane Wanjiru',
      qppvEmail: 'jane.wanjiru@nairobivigil.example',
      role: 'primary',
      nominatedAt: new Date('2026-08-19'),
      counterpart: { fullName: 'Dr. John Otieno', email: 'john.otieno@nairobivigil.example' },
    })

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('renders successfully for a backup nomination referencing the already-appointed primary', async () => {
    const buffer = await service.render({
      companyName: 'Nairobi Vigil Labs',
      registeredAddress: null,
      regulatoryContactEmail: null,
      qppvFullName: 'Dr. John Otieno',
      qppvEmail: 'john.otieno@nairobivigil.example',
      role: 'backup',
      nominatedAt: new Date('2026-08-19'),
      counterpart: { fullName: 'Dr. Jane Wanjiru', email: 'jane.wanjiru@nairobivigil.example' },
    })

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('renders successfully for a backup nomination with no primary appointed yet', async () => {
    const buffer = await service.render({
      companyName: 'Nairobi Vigil Labs',
      registeredAddress: null,
      regulatoryContactEmail: null,
      qppvFullName: 'Dr. John Otieno',
      qppvEmail: 'john.otieno@nairobivigil.example',
      role: 'backup',
      nominatedAt: new Date('2026-08-19'),
      counterpart: null,
    })

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })
})
