import { IsString, MaxLength, MinLength } from 'class-validator'

/** Pass A2 (item 4b) — the written finding recorded against an OOS/OOT investigation. */
export class RecordOosFindingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  findings!: string
}
