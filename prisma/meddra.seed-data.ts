/**
 * A realistic MOCK subset of the MedDRA hierarchy (SOC → HLGT → HLT → PT →
 * LLT) — real, commonly-used pharmacovigilance terminology, structured the
 * way the actual dictionary is, but NOT the official MSSO release (that's
 * blocked on licence — a commercial dependency flagged to the CEO per the
 * build spec). This keeps development honest (real term names, real
 * hierarchy shape, real coding/typeahead workflows to build against) until
 * a licensed release file can be imported via `import:meddra`.
 *
 * `code` values are placeholders (`MOCK-000001`...), not official MedDRA
 * codes — those are only assigned by the MSSO to a licensed release.
 */

export interface MeddraLltSeed {
  name: string
}

export interface MeddraPtSeed {
  name: string
  llts: MeddraLltSeed[]
}

export interface MeddraHltSeed {
  name: string
  pts: MeddraPtSeed[]
}

export interface MeddraHlgtSeed {
  name: string
  hlts: MeddraHltSeed[]
}

export interface MeddraSocSeed {
  name: string
  hlgts: MeddraHlgtSeed[]
}

export const MEDDRA_VERSION_LABEL = 'MOCK-27.0'
export const MEDDRA_VERSION_RELEASED_ON = '2026-03-01'

export const MEDDRA_SOCS: MeddraSocSeed[] = [
  {
    name: 'Skin and subcutaneous tissue disorders',
    hlgts: [
      {
        name: 'Epidermal and dermal conditions',
        hlts: [
          {
            name: 'Bullous conditions',
            pts: [
              {
                name: 'Stevens-Johnson syndrome',
                llts: [{ name: 'Stevens-Johnson syndrome' }, { name: 'SJS' }],
              },
              {
                name: 'Toxic epidermal necrolysis',
                llts: [{ name: 'Toxic epidermal necrolysis' }, { name: 'TEN' }],
              },
              { name: 'Erythema multiforme', llts: [{ name: 'Erythema multiforme' }] },
            ],
          },
          {
            name: 'Rashes, eruptions and exanthemas NEC',
            pts: [
              { name: 'Rash', llts: [{ name: 'Rash NOS' }, { name: 'Skin eruption' }] },
              { name: 'Rash maculo-papular', llts: [{ name: 'Maculopapular rash' }] },
              { name: 'Rash pruritic', llts: [{ name: 'Itchy rash' }] },
              { name: 'Urticaria', llts: [{ name: 'Hives' }, { name: 'Urticaria NOS' }] },
            ],
          },
        ],
      },
      {
        name: 'Skin appendage conditions',
        hlts: [
          {
            name: 'Alopecias',
            pts: [
              { name: 'Alopecia', llts: [{ name: 'Hair loss' }] },
              { name: 'Alopecia areata', llts: [{ name: 'Alopecia areata' }] },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Gastrointestinal disorders',
    hlgts: [
      {
        name: 'Gastrointestinal signs and symptoms',
        hlts: [
          {
            name: 'Nausea and vomiting symptoms',
            pts: [
              { name: 'Nausea', llts: [{ name: 'Nausea NOS' }] },
              { name: 'Vomiting', llts: [{ name: 'Vomiting NOS' }, { name: 'Emesis' }] },
            ],
          },
          {
            name: 'Diarrhoea (excl infective)',
            pts: [
              { name: 'Diarrhoea', llts: [{ name: 'Diarrhoea NOS' }, { name: 'Loose stools' }] },
            ],
          },
        ],
      },
      {
        name: 'Gastrointestinal motility and defaecation conditions',
        hlts: [
          {
            name: 'Constipation',
            pts: [{ name: 'Constipation', llts: [{ name: 'Constipation NOS' }] }],
          },
        ],
      },
      {
        name: 'Hepatobiliary disorders',
        hlts: [
          {
            name: 'Hepatic and hepatobiliary disorders NEC',
            pts: [
              { name: 'Hepatotoxicity', llts: [{ name: 'Drug-induced liver injury' }] },
              { name: 'Jaundice', llts: [{ name: 'Jaundice NOS' }] },
              { name: 'Hepatic failure', llts: [{ name: 'Liver failure' }] },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Nervous system disorders',
    hlgts: [
      {
        name: 'Headaches',
        hlts: [
          {
            name: 'Headaches NEC',
            pts: [
              { name: 'Headache', llts: [{ name: 'Headache NOS' }] },
              { name: 'Migraine', llts: [{ name: 'Migraine NOS' }] },
            ],
          },
        ],
      },
      {
        name: 'Neurological disorders NEC',
        hlts: [
          {
            name: 'Consciousness disturbances (excl confusion)',
            pts: [
              { name: 'Somnolence', llts: [{ name: 'Drowsiness' }] },
              { name: 'Syncope', llts: [{ name: 'Fainting' }] },
              { name: 'Loss of consciousness', llts: [{ name: 'LOC' }] },
            ],
          },
          {
            name: 'Dizziness and giddiness',
            pts: [
              { name: 'Dizziness', llts: [{ name: 'Dizziness NOS' }, { name: 'Lightheadedness' }] },
            ],
          },
        ],
      },
      {
        name: 'Seizures (incl subtypes)',
        hlts: [
          {
            name: 'Seizures NEC',
            pts: [{ name: 'Convulsion', llts: [{ name: 'Seizure' }, { name: 'Fit' }] }],
          },
        ],
      },
    ],
  },
  {
    name: 'General disorders and administration site conditions',
    hlgts: [
      {
        name: 'General system disorders NEC',
        hlts: [
          {
            name: 'Body temperature conditions',
            pts: [
              { name: 'Pyrexia', llts: [{ name: 'Fever' }, { name: 'Pyrexia NOS' }] },
              { name: 'Hypothermia', llts: [{ name: 'Low body temperature' }] },
            ],
          },
          {
            name: 'Asthenic conditions',
            pts: [
              { name: 'Fatigue', llts: [{ name: 'Tiredness' }] },
              { name: 'Asthenia', llts: [{ name: 'Weakness' }] },
            ],
          },
          {
            name: 'Therapeutic and nontherapeutic effects (excl toxicity)',
            pts: [
              { name: 'Drug ineffective', llts: [{ name: 'Lack of efficacy' }] },
              {
                name: 'Therapeutic response decreased',
                llts: [{ name: 'Reduced response to treatment' }],
              },
            ],
          },
        ],
      },
      {
        name: 'Administration site reactions',
        hlts: [
          {
            name: 'Injection site reactions',
            pts: [
              { name: 'Injection site pain', llts: [{ name: 'Injection site pain NOS' }] },
              { name: 'Injection site swelling', llts: [{ name: 'Injection site oedema' }] },
              { name: 'Injection site erythema', llts: [{ name: 'Injection site redness' }] },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Immune system disorders',
    hlgts: [
      {
        name: 'Allergic conditions',
        hlts: [
          {
            name: 'Allergic conditions NEC',
            pts: [
              { name: 'Hypersensitivity', llts: [{ name: 'Allergic reaction' }] },
              {
                name: 'Anaphylactic reaction',
                llts: [{ name: 'Anaphylaxis' }, { name: 'Anaphylactic shock' }],
              },
              { name: 'Angioedema', llts: [{ name: 'Angioneurotic oedema' }] },
            ],
          },
        ],
      },
    ],
  },
]
