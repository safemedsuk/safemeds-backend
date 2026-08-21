import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'

/**
 * VigiCloud Stage 15.1 — deliberately has no `distributorCompanyId`
 * field: linking a distributor to a *real* SafeMeds tenant (the
 * precondition for cross-tenant auto-reconciliation) is never a
 * self-service tenant action — a manufacturer cannot simply claim any
 * other company's UUID as "their distributor" and trigger a cross-tenant
 * read against it with no verification on the other side. That link is
 * platform-only, set via `PlatformDistributorsController` (`super_admin`,
 * matching Stage 0.5's entitlement-console precedent for "this needs a
 * human at SafeMeds to verify a real business relationship first").
 */
export class CreateDistributorDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  name: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactPhone?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  countryId?: string
}
