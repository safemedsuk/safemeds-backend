import { ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator'

const STATUSES = ['open', 'in_progress', 'pending_effectiveness_check', 'closed'] as const

export class UpdateCapaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  rootCause?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  rootCauseCategory?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  rootCauseOther?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  correctiveAction?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  preventiveAction?: string

  @ApiPropertyOptional({ description: 'Reassigning the owner — must hold quality.manage_capa.' })
  @IsOptional()
  @IsNotEmpty()
  @IsUUID()
  ownerUserId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  correctiveActionDueDate?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  preventiveActionDueDate?: string

  @ApiPropertyOptional({ enum: STATUSES.filter((s) => s !== 'closed') })
  @IsOptional()
  @IsIn(STATUSES.filter((s) => s !== 'closed'))
  status?: (typeof STATUSES)[number]
}
