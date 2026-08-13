import { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface'
import { ClinicalTrialSubjectImporter } from './clinical-trial-subject.importer'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['REGULATORY_AFFAIRS_OFFICER'],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const findTrialByReference = jest.fn()
  const enrollSubject = jest.fn().mockResolvedValue({ id: 'subject-1' })
  const clinicalTrialService = { findTrialByReference, enrollSubject } as never

  const importer = new ClinicalTrialSubjectImporter(clinicalTrialService)
  return { importer, findTrialByReference, enrollSubject }
}

describe('ClinicalTrialSubjectImporter', () => {
  describe('validateRow()', () => {
    it('requires trialReference, subjectCode, and enrolledAt', () => {
      const { importer } = buildHarness()
      const errors = importer.validateRow({ trialReference: '', subjectCode: '', enrolledAt: '' })
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Trial Reference'),
          expect.stringContaining('Subject Code'),
          expect.stringContaining('Enrollment Date'),
        ]),
      )
    })

    it('rejects an unparseable enrollment date', () => {
      const { importer } = buildHarness()
      const errors = importer.validateRow({
        trialReference: 'NCT-001',
        subjectCode: 'SUBJ-1',
        enrolledAt: 'not-a-date',
      })
      expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('not a valid date')]))
    })

    it('rejects an out-of-range age', () => {
      const { importer } = buildHarness()
      const errors = importer.validateRow({
        trialReference: 'NCT-001',
        subjectCode: 'SUBJ-1',
        enrolledAt: '2026-01-01',
        ageYears: '999',
      })
      expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('Age')]))
    })

    it('rejects an unrecognized sex value', () => {
      const { importer } = buildHarness()
      const errors = importer.validateRow({
        trialReference: 'NCT-001',
        subjectCode: 'SUBJ-1',
        enrolledAt: '2026-01-01',
        sex: 'not-a-sex',
      })
      expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('Sex')]))
    })

    it('accepts a fully valid row', () => {
      const { importer } = buildHarness()
      const errors = importer.validateRow({
        trialReference: 'NCT-001',
        subjectCode: 'SUBJ-1',
        enrolledAt: '2026-01-01',
        sex: 'female',
        ageYears: '34',
      })
      expect(errors).toEqual([])
    })

    it('accepts a row with the optional columns blank', () => {
      const { importer } = buildHarness()
      const errors = importer.validateRow({
        trialReference: 'NCT-001',
        subjectCode: 'SUBJ-1',
        enrolledAt: '2026-01-01',
      })
      expect(errors).toEqual([])
    })
  })

  describe('commitRow()', () => {
    it('resolves the trial by reference and enrolls the subject', async () => {
      const { importer, findTrialByReference, enrollSubject } = buildHarness()
      findTrialByReference.mockResolvedValue({ id: 'trial-1', trialReference: 'NCT-001' })

      await importer.commitRow(
        actor,
        {
          trialReference: 'NCT-001',
          subjectCode: 'SUBJ-1',
          enrolledAt: '2026-01-01',
          sex: 'Female',
          ageYears: '34',
        },
        {},
      )

      expect(findTrialByReference).toHaveBeenCalledWith(actor, 'NCT-001')
      expect(enrollSubject).toHaveBeenCalledWith(
        actor,
        'trial-1',
        expect.objectContaining({ subjectCode: 'SUBJ-1', sex: 'female', ageYears: 34 }),
        {},
      )
    })

    it('throws a clear error when the trial reference does not resolve to a real trial', async () => {
      const { importer, findTrialByReference } = buildHarness()
      findTrialByReference.mockResolvedValue(null)

      await expect(
        importer.commitRow(
          actor,
          { trialReference: 'NCT-DOES-NOT-EXIST', subjectCode: 'SUBJ-1', enrolledAt: '2026-01-01' },
          {},
        ),
      ).rejects.toThrow(/No clinical trial found/)
    })
  })
})
