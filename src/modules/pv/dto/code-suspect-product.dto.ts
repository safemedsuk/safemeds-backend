import { ApiProperty } from '@nestjs/swagger'
import { IsUUID } from 'class-validator'

export class CodeSuspectProductDto {
  @ApiProperty({
    description:
      "A WhoDrugTerm id to assign as this suspect/concomitant product's coded drug dictionary entry",
  })
  @IsUUID()
  whoDrugTermId: string
}
