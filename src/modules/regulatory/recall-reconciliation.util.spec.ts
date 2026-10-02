import { computeRecallReconciliation } from './recall-reconciliation.util'

describe('computeRecallReconciliation', () => {
  it('reproduces the Engineering Build Package’s own real acceptance fixture exactly', () => {
    // distributed 10,000 (KE 7,000 / UG 1,800 / TZ 1,200); recovered
    // 7,600; quarantined 1,400; accounted 9,000; outstanding 1,000;
    // 90.0% accounted; destroyed 6,200 of 7,600 recovered, 1,400
    // awaiting destruction.
    const result = computeRecallReconciliation({
      distributed: 10_000,
      recovered: 7_600,
      quarantined: 1_400,
      dispensed: 0,
      other: 0,
      destroyed: 6_200,
      batchSize: 12_000,
    })

    expect(result.accounted).toBe(9_000)
    expect(result.outstanding).toBe(1_000)
    expect(result.percentAccounted).toBeCloseTo(0.9, 5)
    expect(result.destroyed).toBe(6_200)
    expect(result.recovered - result.destroyed).toBe(1_400) // awaiting destruction
    expect(result.heldByMah).toBe(2_000)
  })

  it('never double-counts destroyed stock into accounted (destroyed is a subset of recovered)', () => {
    const result = computeRecallReconciliation({
      distributed: 100,
      recovered: 80,
      quarantined: 0,
      dispensed: 0,
      other: 0,
      destroyed: 80,
      batchSize: 100,
    })
    // accounted only ever sums recovered/quarantined/dispensed/other —
    // destroyed is never added a second time.
    expect(result.accounted).toBe(80)
  })

  it('handles a fully accounted-for recall with zero outstanding', () => {
    const result = computeRecallReconciliation({
      distributed: 500,
      recovered: 400,
      quarantined: 100,
      dispensed: 0,
      other: 0,
      destroyed: 0,
      batchSize: 500,
    })
    expect(result.outstanding).toBe(0)
    expect(result.percentAccounted).toBe(1)
  })

  it('returns 0% accounted, not NaN, when nothing has been distributed yet', () => {
    const result = computeRecallReconciliation({
      distributed: 0,
      recovered: 0,
      quarantined: 0,
      dispensed: 0,
      other: 0,
      destroyed: 0,
      batchSize: 0,
    })
    expect(result.percentAccounted).toBe(0)
  })
})
