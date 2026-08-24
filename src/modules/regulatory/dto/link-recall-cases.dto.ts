import { ApiProperty } from '@nestjs/swagger'
import { IsString } from 'class-validator'

export class LinkRecallCasesDto {
  @ApiProperty({ type: [String] })
  @IsString({ each: true })
  caseIds!: string[]
}
