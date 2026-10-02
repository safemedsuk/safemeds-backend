import { IsUUID } from 'class-validator'

export class CompleteRecallDestructionDto {
  @IsUUID()
  certificateEvidenceId!: string
}
