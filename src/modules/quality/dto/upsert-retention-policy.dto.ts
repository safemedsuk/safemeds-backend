import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator'

export class UpsertRetentionPolicyDto {
  /**
   * Plain string, not an enum — e.g. `controlled_document`, `deviation`,
   * `capa`, `complaint`, `oos_oot`, `training_record` — a company's own
   * record-type vocabulary is expected to grow as later QualCloud stages
   * ship, so this is deliberately open, matching every other
   * "confirmed categories, flexible column" field in this schema.
   */
  @MinLength(1)
  @MaxLength(50)
  @IsString()
  recordType!: string

  @IsInt()
  @Min(1)
  @Max(100)
  retentionYears!: number
}
