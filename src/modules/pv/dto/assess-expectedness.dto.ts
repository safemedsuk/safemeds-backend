import { ApiProperty } from '@nestjs/swagger'
import { ExpectednessFlag } from '@prisma/client'
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'

export class AssessExpectednessDto {
  @ApiProperty({ enum: ExpectednessFlag })
  @IsEnum(ExpectednessFlag)
  expectednessFlag: ExpectednessFlag

  @ApiProperty({
    required: false,
    description: "The reviewer's reasoning — e.g. which label version they checked against.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string
}
