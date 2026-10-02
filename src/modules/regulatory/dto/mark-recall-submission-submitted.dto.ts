import { IsUUID } from 'class-validator'

export class MarkRecallSubmissionSubmittedDto {
  @IsUUID()
  submittedProofDocumentId!: string
}
