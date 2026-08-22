import { ApiPropertyOptional } from '@nestjs/swagger'
import { DistributorStatus } from '@prisma/client'
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator'

export class UpdateDistributorDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactPhone?: string

  @ApiPropertyOptional({ enum: DistributorStatus })
  @IsOptional()
  @IsEnum(DistributorStatus)
  status?: DistributorStatus
}
