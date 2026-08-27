import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { LocationScopeLevel } from '@prisma/client'
import { IsEnum, IsOptional, IsUUID } from 'class-validator'

export class GrantLocationScopeDto {
  @ApiProperty({
    enum: LocationScopeLevel,
    description:
      '"market" scopes to every facility in a country; "facility" scopes to exactly one site',
  })
  @IsEnum(LocationScopeLevel)
  level: LocationScopeLevel

  @ApiPropertyOptional({ description: 'Required when level is "market"' })
  @IsOptional()
  @IsUUID()
  countryId?: string

  @ApiPropertyOptional({ description: 'Required when level is "facility"' })
  @IsOptional()
  @IsUUID()
  facilityId?: string
}
