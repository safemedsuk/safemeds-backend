/**
 * QualCloud (Phase 13) Stage 10.9 — the real, country-by-country recall
 * rule content status from the Country Rules Content Pack, transcribed
 * directly rather than guessed. Per that section's own table:
 *
 * - **Tanzania (TMDA)** — verified source, real completion deadlines
 *   from the day the Authority approves the recall (Class I 14 days,
 *   Class II 21 days, Class III 30 days — GN 313, 2015), but the day
 *   basis (calendar vs. working) is **not yet confirmed** — seeded
 *   `unverified: true` for exactly that reason, per the Content Pack's
 *   own explicit instruction not to flip it to `false` until confirmed.
 * - **Rwanda (Rwanda FDA)** — verified source, a real 24-hour written
 *   notification requirement for a voluntary recall (CBD/TRG/019
 *   Rev_1, 2021) — seeded `unverified: false`.
 * - **Zimbabwe (MCAZ)** — verified source, precautionary quarantine may
 *   be initiated within 24 hours of a significant hazard (2015
 *   procedure) — seeded `unverified: false`.
 *
 * **Deliberately not seeded, per this same section's own instruction**:
 * Kenya (PPB — no class-definition text or completion deadlines
 * extracted yet, despite an otherwise-verified source), South Africa/
 * Ghana/Nigeria (verified legal basis, but no concrete day-count to
 * seed), Uganda/Zambia (from Robert's own notes only, not yet
 * independently re-checked), and Ethiopia/Malawi/Mozambique
 * (guidelines not located at all). None of this blocks the rules
 * *engine* itself — only which countries' rows may ever go live.
 */

export interface RecallRuleSeed {
  code: string
  requirementText: string
  appliesWhenClass?: string
  appliesWhenType?: string
  anchorEvent: string
  offset: number
  dayBasis: 'calendar' | 'working'
  ownerRoleKey: string
  sourceDoc: string
  sourceInstrument?: string
  sourceSection?: string
  unverified: boolean
}

export interface RecallRuleSetSeed {
  countryIso: string
  authorityCode: string
  rules: RecallRuleSeed[]
}

export const RECALL_RULE_SETS: RecallRuleSetSeed[] = [
  {
    countryIso: 'TZ',
    authorityCode: 'TMDA',
    rules: [
      {
        code: 'completion-class-1',
        requirementText: 'Complete a Class I recall within 14 days of TMDA approving the recall.',
        appliesWhenClass: 'I',
        anchorEvent: 'regulator_approval_of_recall',
        offset: 14,
        dayBasis: 'calendar',
        ownerRoleKey: 'QUALITY_MANAGER',
        sourceDoc: 'GN 313 (2015)',
        sourceInstrument: 'The Tanzania Medicines and Medical Devices Act — Recall Procedure',
        sourceSection: 'Reg. 4',
        unverified: true,
      },
      {
        code: 'completion-class-2',
        requirementText: 'Complete a Class II recall within 21 days of TMDA approving the recall.',
        appliesWhenClass: 'II',
        anchorEvent: 'regulator_approval_of_recall',
        offset: 21,
        dayBasis: 'calendar',
        ownerRoleKey: 'QUALITY_MANAGER',
        sourceDoc: 'GN 313 (2015)',
        sourceInstrument: 'The Tanzania Medicines and Medical Devices Act — Recall Procedure',
        sourceSection: 'Reg. 4',
        unverified: true,
      },
      {
        code: 'completion-class-3',
        requirementText: 'Complete a Class III recall within 30 days of TMDA approving the recall.',
        appliesWhenClass: 'III',
        anchorEvent: 'regulator_approval_of_recall',
        offset: 30,
        dayBasis: 'calendar',
        ownerRoleKey: 'QUALITY_MANAGER',
        sourceDoc: 'GN 313 (2015)',
        sourceInstrument: 'The Tanzania Medicines and Medical Devices Act — Recall Procedure',
        sourceSection: 'Reg. 4',
        unverified: true,
      },
    ],
  },
  {
    countryIso: 'RW',
    authorityCode: 'RFDA',
    rules: [
      {
        code: 'voluntary-notify-24h',
        requirementText: 'Notify Rwanda FDA in writing of a voluntary recall within 24 hours of the recall decision.',
        appliesWhenType: 'voluntary',
        anchorEvent: 'recall_decision',
        offset: 1,
        dayBasis: 'calendar',
        ownerRoleKey: 'QUALITY_MANAGER',
        sourceDoc: 'CBD/TRG/019 Rev_1 (2021)',
        sourceInstrument: 'Rwanda FDA Guideline on Product Recall',
        unverified: false,
      },
    ],
  },
  {
    countryIso: 'ZW',
    authorityCode: 'MCAZ',
    rules: [
      {
        code: 'precautionary-quarantine-24h',
        requirementText: 'Initiate precautionary quarantine of the affected product within 24 hours of identifying a significant hazard.',
        anchorEvent: 'trigger_received',
        offset: 1,
        dayBasis: 'calendar',
        ownerRoleKey: 'QUALITY_ASSOCIATE',
        sourceDoc: 'MCAZ Recall Procedure (2015)',
        unverified: false,
      },
    ],
  },
]
