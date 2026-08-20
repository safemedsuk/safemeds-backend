import { ApiProperty } from '@nestjs/swagger'
import { IsUUID } from 'class-validator'

export class CodeAdverseEventDto {
  @ApiProperty({
    description:
      "A MeddraTerm id (any level — real coding practice assigns the closest-matching LLT) to assign as this reaction's coded term",
  })
  @IsUUID()
  meddraTermId: string
}
