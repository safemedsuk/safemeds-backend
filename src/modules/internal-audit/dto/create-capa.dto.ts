import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'

import { CapaAllocationDto } from './capa-allocation.dto'

export class CreateCapaDto extends CapaAllocationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  findingId?: string

  /**
   * QualCloud (Phase 13) Stage 0.3 — the generalized polymorphic pair.
   * `findingId` alone still works unchanged (auto-mapped to
   * `sourceRecordType: 'audit_finding'`).
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceRecordType?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceRecordId?: string
}
