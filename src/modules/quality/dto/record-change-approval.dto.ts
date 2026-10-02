import { IsOptional, IsString, MaxLength } from 'class-validator'

export class RecordChangeApprovalDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string
}
