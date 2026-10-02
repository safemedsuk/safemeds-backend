import { IsUUID } from 'class-validator'

export class AttachRecallDisposalApprovalDto {
  @IsUUID()
  disposalApprovalEvidenceId!: string
}
