import { IsIn, IsString, MaxLength, MinLength } from 'class-validator'

const SEVERITIES = ['critical', 'major', 'minor', 'observation'] as const

export class CreateAuditFindingDto {
  @MinLength(1)
  @MaxLength(2000)
  @IsString()
  description!: string

  @IsIn(SEVERITIES)
  severity!: (typeof SEVERITIES)[number]
}
