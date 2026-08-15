import { SubmissionChannel } from '@prisma/client'
import { IsDateString, IsEnum, IsString, IsUUID } from 'class-validator'

export class CreateSubmissionFormatDto {
  @IsUUID()
  authorityId!: string

  @IsUUID()
  reportTypeId!: string

  @IsString()
  templateRef!: string

  @IsEnum(SubmissionChannel)
  channel!: SubmissionChannel

  @IsDateString()
  effectiveFrom!: string
}
