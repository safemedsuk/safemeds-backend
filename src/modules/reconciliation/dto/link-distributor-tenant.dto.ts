import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsUUID } from 'class-validator'

export class LinkDistributorTenantDto {
  @ApiPropertyOptional({
    description: 'The real SafeMeds tenant Company id this distributor is — omit/null to unlink',
  })
  @IsOptional()
  @IsUUID()
  targetCompanyId?: string | null
}
