import { RECALL_RULE_SETS } from '../../../prisma/recall-rules.seed-data'

/**
 * QualCloud (Phase 13) Stage 10.9 — the real, country-by-country recall
 * rule content. This spec proves the seed data's own internal
 * consistency (never duplicate codes, Tanzania's day-basis uncertainty
 * is honestly flagged) rather than anything about the seed *script* —
 * `prisma/seed.ts`'s own idempotency is exercised directly against a
 * real database, not here.
 */
describe('recall rules seed data consistency', () => {
  it('seeds exactly Tanzania/TMDA, Rwanda/RFDA, and Zimbabwe/MCAZ — never Kenya, South Africa, Ghana, Nigeria, Uganda, Zambia, Ethiopia, Malawi, or Mozambique, per 10.9’s own explicit "do not seed" instruction', () => {
    const keys = RECALL_RULE_SETS.map((r) => `${r.countryIso}::${r.authorityCode}`)
    expect(new Set(keys)).toEqual(new Set(['TZ::TMDA', 'RW::RFDA', 'ZW::MCAZ']))
  })

  it('every rule code is unique within its own rule-set', () => {
    for (const ruleSet of RECALL_RULE_SETS) {
      const codes = ruleSet.rules.map((r) => r.code)
      expect(new Set(codes).size).toBe(codes.length)
    }
  })

  it('Tanzania’s three completion-deadline rules are all unverified — the day basis (calendar vs. working) is not yet confirmed', () => {
    const tanzania = RECALL_RULE_SETS.find((r) => r.countryIso === 'TZ')!
    expect(tanzania.rules).toHaveLength(3)
    for (const rule of tanzania.rules) {
      expect(rule.unverified).toBe(true)
    }
  })

  it('Tanzania’s three rules cover Class I (14d), II (21d), and III (30d) exactly, anchored on regulator approval', () => {
    const tanzania = RECALL_RULE_SETS.find((r) => r.countryIso === 'TZ')!
    const byClass = new Map(tanzania.rules.map((r) => [r.appliesWhenClass, r.offset]))
    expect(byClass.get('I')).toBe(14)
    expect(byClass.get('II')).toBe(21)
    expect(byClass.get('III')).toBe(30)
    for (const rule of tanzania.rules) {
      expect(rule.anchorEvent).toBe('regulator_approval_of_recall')
    }
  })

  it('Rwanda and Zimbabwe’s single rules are both confirmed (unverified: false), each with a real source citation', () => {
    const rwanda = RECALL_RULE_SETS.find((r) => r.countryIso === 'RW')!
    const zimbabwe = RECALL_RULE_SETS.find((r) => r.countryIso === 'ZW')!
    for (const ruleSet of [rwanda, zimbabwe]) {
      for (const rule of ruleSet.rules) {
        expect(rule.unverified).toBe(false)
        expect(rule.sourceDoc.length).toBeGreaterThan(0)
      }
    }
  })

  it('Rwanda’s rule only applies to a voluntary recall, matching the real source text', () => {
    const rwanda = RECALL_RULE_SETS.find((r) => r.countryIso === 'RW')!
    expect(rwanda.rules[0].appliesWhenType).toBe('voluntary')
  })
})
