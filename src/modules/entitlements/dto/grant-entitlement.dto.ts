import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator'

export class GrantEntitlementDto {
  @ApiProperty({ description: 'e.g. "vigicloud", "qualcloud", "regcloud"' })
  @IsString()
  @IsNotEmpty()
  moduleKey: string

  @ApiPropertyOptional({
    description: 'Omit for a module-level grant (defaults to the "*" sentinel)',
  })
  @IsOptional()
  @IsString()
  featureKey?: string

  @ApiProperty()
  @IsBoolean()
  enabled: boolean
}
