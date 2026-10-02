import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator'

export class RecordOosPhase1Dto {
  @IsBoolean()
  assignableCauseFound!: boolean

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  findings?: string
}
