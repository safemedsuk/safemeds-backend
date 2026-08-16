import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateCapaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  findingId?: string

  @MinLength(1)
  @MaxLength(200)
  @IsString()
  title!: string

  @MinLength(1)
  @MaxLength(2000)
  @IsString()
  correctiveAction!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  preventiveAction?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerUserId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string
}
