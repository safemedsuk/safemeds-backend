import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsBoolean, IsOptional, IsString } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListPvCasesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by workflow status key, e.g. "intake", "triage"' })
  @IsOptional()
  @IsString()
  status?: string

  @ApiPropertyOptional({ description: 'Case-insensitive match against the case reference number' })
  @IsOptional()
  @IsString()
  search?: string

  /**
   * VigiCloud Stage 3 — filters to (or excludes) cases still awaiting
   * human confirmation after system-channel intake (public URL, email,
   * WhatsApp). Drives the Draft Review queue screen.
   */
  @ApiPropertyOptional({
    description:
      'true = only draft-review cases, false = only confirmed/authenticated ones, omit = all',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  requiresDraftReview?: boolean
}
