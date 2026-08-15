import { ApiProperty } from '@nestjs/swagger'
import { DataSubjectRequestType } from '@prisma/client'
import { IsEnum, IsNotEmpty, IsString } from 'class-validator'

export class CreateDataSubjectRequestDto {
  @ApiProperty({ description: 'Polymorphic target, e.g. "pv_case"' })
  @IsString()
  @IsNotEmpty()
  recordType: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  recordId: string

  @ApiProperty({ enum: DataSubjectRequestType })
  @IsEnum(DataSubjectRequestType)
  requestType: DataSubjectRequestType
}
