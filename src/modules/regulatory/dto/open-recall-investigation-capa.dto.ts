import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export class OpenRecallInvestigationCapaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string

  @IsString()
  @MinLength(1)
  correctiveAction!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  preventiveAction?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  rootCauseCategory?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerUserId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dueDate?: string
}
