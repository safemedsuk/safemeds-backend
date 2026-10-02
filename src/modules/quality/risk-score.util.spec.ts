import { computeRiskScore } from './risk-score.util'

describe('computeRiskScore', () => {
  it('computes a plain severity × probability product with no detectability', () => {
    expect(computeRiskScore(2, 3)).toEqual({ score: 6, riskLevel: 'low' })
  })

  it('computes the full FMEA RPN (severity × probability × detectability) when given all three', () => {
    expect(computeRiskScore(5, 5, 5)).toEqual({ score: 125, riskLevel: 'high' })
  })

  it('classifies low/medium/high via a tertile split of the 2-factor max (25, thresholds ~8.33/~16.67)', () => {
    expect(computeRiskScore(1, 1).riskLevel).toBe('low') // 1 <= 8.33
    expect(computeRiskScore(3, 3).riskLevel).toBe('medium') // 9, 8.33 < 9 <= 16.67
    expect(computeRiskScore(5, 4).riskLevel).toBe('high') // 20 > 16.67
  })

  it('classifies low/medium/high via a tertile split of the 3-factor max (125, thresholds ~41.67/~83.33)', () => {
    expect(computeRiskScore(2, 2, 2).riskLevel).toBe('low') // 8 <= 41.67
    expect(computeRiskScore(4, 4, 3).riskLevel).toBe('medium') // 48, 41.67 < 48 <= 83.33
    expect(computeRiskScore(5, 5, 4).riskLevel).toBe('high') // 100 > 83.33
  })

  it('treats a null detectability the same as omitted (2-factor formula)', () => {
    expect(computeRiskScore(2, 3, null)).toEqual({ score: 6, riskLevel: 'low' })
  })
})
