/**
 * QualCloud (Phase 13) Stage 0.3 — ICH Q9's classic FMEA Risk Priority
 * Number (severity × probability × detectability) when `detectability`
 * is supplied, or a plain severity × probability product otherwise (the
 * simpler 2-axis matrix `RiskAssessment.riskMethod`'s own schema comment
 * describes for teams that don't want a 3-factor RPN). Kept as a pure,
 * independently-testable function — the same "formula lives in one
 * place, easy to read and change without a migration" precedent
 * `computeNaranjoScore()`/`EurdCadenceUtil` already established in this
 * codebase — rather than a DB-generated column.
 *
 * `riskLevel` thresholds are a 🧭 conventional tertile split of the
 * maximum possible score for whichever formula was used (125 for a
 * 3-factor RPN, 25 for a 2-factor product) — admin-editable in a future
 * pass (see `needs.md`), a coded default for now.
 */
export function computeRiskScore(
  severity: number,
  probability: number,
  detectability?: number | null,
): { score: number; riskLevel: 'low' | 'medium' | 'high' } {
  const score =
    detectability != null ? severity * probability * detectability : severity * probability
  const maxScore = detectability != null ? 125 : 25

  const riskLevel: 'low' | 'medium' | 'high' =
    score <= maxScore / 3 ? 'low' : score <= (2 * maxScore) / 3 ? 'medium' : 'high'

  return { score, riskLevel }
}
