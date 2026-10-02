/**
 * QualCloud (Phase 13) Stage 10.5 — the mass-balance formulas, transcribed
 * directly from the Engineering Build Package. Computed live, never a
 * manually-editable number.
 *
 * ```
 * accounted    = recovered (genuine returns only) + quarantined_at_sites + dispensed_evidenced + other_evidenced
 * outstanding  = distributed − accounted
 * % accounted  = accounted / distributed
 * destroyed    ⊆ recovered   (destruction never adds a second time to accounted)
 * held_by_mah  = batch_size − distributed
 * ```
 */
export interface RecallReconciliationInput {
  distributed: number
  recovered: number
  quarantined: number
  dispensed: number
  other: number
  destroyed: number
  batchSize: number
}

export interface RecallReconciliationResult {
  distributed: number
  recovered: number
  quarantined: number
  dispensed: number
  other: number
  accounted: number
  outstanding: number
  percentAccounted: number
  destroyed: number
  heldByMah: number
}

export function computeRecallReconciliation(
  input: RecallReconciliationInput,
): RecallReconciliationResult {
  const accounted = input.recovered + input.quarantined + input.dispensed + input.other
  const outstanding = input.distributed - accounted
  const percentAccounted = input.distributed > 0 ? accounted / input.distributed : 0
  const heldByMah = input.batchSize - input.distributed

  return {
    distributed: input.distributed,
    recovered: input.recovered,
    quarantined: input.quarantined,
    dispensed: input.dispensed,
    other: input.other,
    accounted,
    outstanding,
    percentAccounted,
    destroyed: input.destroyed,
    heldByMah,
  }
}
