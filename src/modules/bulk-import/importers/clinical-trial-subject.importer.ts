import { Injectable } from '@nestjs/common'
import { PatientSex } from '@prisma/client'

import { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface'
import { ClinicalTrialService } from '../../pv/clinical-trial.service'
import { Importer, ImporterColumn, RequestMeta } from './importer.interface'

const VALID_SEX_VALUES = new Set<string>(['male', 'female', 'unknown'])

/**
 * VigiCloud Stage 14 — "Bulk import of clinical-trial patient sets
 * (Stage 0.6's importer framework, a new importer target)," per this
 * stage's own build-spec text and exactly the importer name
 * `Importer`'s own doc comment already predicted (`clinical_trial_patient`).
 * Reuses `ClinicalTrialService.findTrialByReference()`/`.enrollSubject()`
 * row-by-row — no duplicated validation logic, same shape as
 * `ProductImporter` reusing `MasterDataService.createProduct()`.
 * Deliberately has no column for the treatment-arm assignment — a bulk
 * spreadsheet is not the place to introduce a blinded value into the
 * system; that stays a deliberate, individually-signed action via
 * `EnrollTrialSubjectDto.treatmentArm` on the real API, or is left null
 * (unassigned/unknown to SafeMeds) until later.
 */
@Injectable()
export class ClinicalTrialSubjectImporter implements Importer {
  readonly importType = 'clinical_trial_patient'
  readonly label = 'Bulk import clinical trial subjects'
  readonly requiredPermission = 'pv.manage_clinical_trials'
  readonly columns: ImporterColumn[] = [
    {
      key: 'trialReference',
      label: 'Trial Reference',
      required: true,
      aliases: ['Trial', 'Protocol Number', 'Protocol Reference'],
    },
    {
      key: 'subjectCode',
      label: 'Subject Code',
      required: true,
      aliases: ['Subject ID', 'Patient Code', 'Subject'],
    },
    { key: 'sex', label: 'Sex', required: false, aliases: ['Gender'] },
    { key: 'ageYears', label: 'Age (years)', required: false, aliases: ['Age'] },
    {
      key: 'enrolledAt',
      label: 'Enrollment Date',
      required: true,
      aliases: ['Enrolled On', 'Enrollment', 'Date Enrolled'],
    },
  ]

  constructor(private readonly clinicalTrialService: ClinicalTrialService) {}

  validateRow(row: Record<string, string>): string[] {
    const errors: string[] = []

    if (!row.trialReference?.trim()) errors.push('Trial Reference is required')
    if (!row.subjectCode?.trim()) errors.push('Subject Code is required')

    if (!row.enrolledAt?.trim()) {
      errors.push('Enrollment Date is required')
    } else if (Number.isNaN(Date.parse(row.enrolledAt))) {
      errors.push(`Enrollment Date "${row.enrolledAt}" is not a valid date`)
    }

    if (row.sex?.trim() && !VALID_SEX_VALUES.has(row.sex.trim().toLowerCase())) {
      errors.push(`Sex "${row.sex}" must be one of: male, female, unknown`)
    }

    if (
      row.ageYears?.trim() &&
      (Number.isNaN(Number(row.ageYears)) || Number(row.ageYears) < 0 || Number(row.ageYears) > 130)
    ) {
      errors.push(`Age "${row.ageYears}" must be a number between 0 and 130`)
    }

    return errors
  }

  async commitRow(
    actor: AuthenticatedUser,
    row: Record<string, string>,
    meta: RequestMeta,
  ): Promise<void> {
    const trial = await this.clinicalTrialService.findTrialByReference(
      actor,
      row.trialReference.trim(),
    )
    if (!trial) {
      throw new Error(`No clinical trial found with reference "${row.trialReference.trim()}"`)
    }

    await this.clinicalTrialService.enrollSubject(
      actor,
      trial.id,
      {
        subjectCode: row.subjectCode.trim(),
        sex: (row.sex?.trim().toLowerCase() as PatientSex | undefined) ?? undefined,
        ageYears: row.ageYears?.trim() ? Number(row.ageYears) : undefined,
        enrolledAt: new Date(row.enrolledAt).toISOString(),
      },
      meta,
    )
  }
}
