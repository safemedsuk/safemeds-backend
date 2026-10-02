import { IsOptional, IsUUID } from 'class-validator'

export class CreateRecallRuleSetDto {
  @IsUUID()
  countryId!: string

  @IsUUID()
  regulatoryAuthorityId!: string

  /** Optional free-text note carried into the audit entry only — not a schema field. */
  @IsOptional()
  note?: string
}
