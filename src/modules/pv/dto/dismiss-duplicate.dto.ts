import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString } from 'class-validator'

/** VigiCloud Stage 10 — documenting a genuine "not a duplicate" decision, part of the EMA guideline's own process, not just a way to dismiss a false positive silently. */
export class DismissDuplicateDto {
  @ApiProperty({ description: 'Why these two cases are not duplicates' })
  @IsString()
  @IsNotEmpty()
  reviewNote: string
}
