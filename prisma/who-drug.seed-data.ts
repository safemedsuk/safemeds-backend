/**
 * A realistic MOCK subset standing in for WHODrug Global — real,
 * commonly-used drug names and ATC codes, structured the way the real
 * dictionary is (one entry per trade-name/generic-name combination,
 * linked to an active substance and an ATC code), but NOT the official
 * UMC release (that's blocked on a commercial subscription — see
 * `needs.md` §12, the same shape of dependency already flagged for
 * MedDRA). This keeps development honest (real drug names, real coding
 * workflows to build against) until a real subscription exists.
 *
 * `drugRecordNumber` values are placeholders (`MOCK-DRN-000001`...), not
 * official WHODrug DRNs — those are only assigned by UMC to a licensed
 * release. Several entries deliberately match the products named in the
 * real Kenya PPB E2B(R3) sample case in `vigicloud docs/` (Depo-Provera,
 * Etamsylate) so a coder testing against this mock set sees names that
 * genuinely appear in real Kenyan ICSRs, not arbitrary placeholders.
 */

export interface WhoDrugTermSeed {
  name: string
  substanceName: string
  atcCode: string
}

export const WHO_DRUG_VERSION_LABEL = 'MOCK-B3-2026.1'
export const WHO_DRUG_VERSION_RELEASED_ON = '2026-03-01'

export const WHO_DRUG_TERMS: WhoDrugTermSeed[] = [
  { name: 'Panadol', substanceName: 'PARACETAMOL', atcCode: 'N02BE01' },
  { name: 'Panadol Extra', substanceName: 'PARACETAMOL; CAFFEINE', atcCode: 'N02BE51' },
  { name: 'Depo-Provera', substanceName: 'MEDROXYPROGESTERONE ACETATE', atcCode: 'G03AC06' },
  { name: 'Etamsylate', substanceName: 'ETAMSILATE', atcCode: 'B02BX01' },
  { name: 'Amoxil', substanceName: 'AMOXICILLIN', atcCode: 'J01CA04' },
  { name: 'Augmentin', substanceName: 'AMOXICILLIN; CLAVULANIC ACID', atcCode: 'J01CR02' },
  { name: 'Flagyl', substanceName: 'METRONIDAZOLE', atcCode: 'J01XD01' },
  { name: 'Coartem', substanceName: 'ARTEMETHER; LUMEFANTRINE', atcCode: 'P01BF01' },
  { name: 'Fansidar', substanceName: 'SULFADOXINE; PYRIMETHAMINE', atcCode: 'P01BD51' },
  { name: 'Ventolin', substanceName: 'SALBUTAMOL', atcCode: 'R03AC02' },
  { name: 'Piriton', substanceName: 'CHLORPHENAMINE MALEATE', atcCode: 'R06AB04' },
  { name: 'Voltaren', substanceName: 'DICLOFENAC', atcCode: 'M01AB05' },
  { name: 'Brufen', substanceName: 'IBUPROFEN', atcCode: 'M01AE01' },
  { name: 'Zantac', substanceName: 'RANITIDINE', atcCode: 'A02BA02' },
  { name: 'Losec', substanceName: 'OMEPRAZOLE', atcCode: 'A02BC01' },
  { name: 'Glucophage', substanceName: 'METFORMIN', atcCode: 'A10BA02' },
  { name: 'Lantus', substanceName: 'INSULIN GLARGINE', atcCode: 'A10AE04' },
  { name: 'Amlodipine Sandoz', substanceName: 'AMLODIPINE', atcCode: 'C08CA01' },
  { name: 'Zestril', substanceName: 'LISINOPRIL', atcCode: 'C09AA03' },
  { name: 'Warfarin Teva', substanceName: 'WARFARIN SODIUM', atcCode: 'B01AA03' },
  { name: 'Septrin', substanceName: 'SULFAMETHOXAZOLE; TRIMETHOPRIM', atcCode: 'J01EE01' },
  { name: 'Nevirapine Cipla', substanceName: 'NEVIRAPINE', atcCode: 'J05AG01' },
  {
    name: 'Tenofovir/Lamivudine/Dolutegravir',
    substanceName: 'TENOFOVIR; LAMIVUDINE; DOLUTEGRAVIR',
    atcCode: 'J05AR21',
  },
  {
    name: 'Rifafour',
    substanceName: 'RIFAMPICIN; ISONIAZID; PYRAZINAMIDE; ETHAMBUTOL',
    atcCode: 'J04AM06',
  },
  { name: 'Depo-Medrol', substanceName: 'METHYLPREDNISOLONE ACETATE', atcCode: 'H02AB04' },
  { name: 'Diazepam Injection', substanceName: 'DIAZEPAM', atcCode: 'N05BA01' },
  { name: 'Pethidine Injection', substanceName: 'PETHIDINE HYDROCHLORIDE', atcCode: 'N02AB02' },
  { name: 'Oxytocin Injection', substanceName: 'OXYTOCIN', atcCode: 'H01BB02' },
  { name: 'Magnesium Sulfate Injection', substanceName: 'MAGNESIUM SULFATE', atcCode: 'A12CC02' },
  { name: 'Ferrous Sulfate', substanceName: 'FERROUS SULFATE', atcCode: 'B03AA07' },
]
