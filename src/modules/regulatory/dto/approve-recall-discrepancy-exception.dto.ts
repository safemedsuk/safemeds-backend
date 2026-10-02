import { IsString, MinLength } from 'class-validator'

export class ApproveRecallDiscrepancyExceptionDto {
  @IsString()
  @MinLength(1)
  note!: string
}
