import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'

export class CreateGeneratedReportDto {
  @ApiProperty({
    description: 'pv | qualcloud | regcloud — which domain module this report belongs to',
  })
  @IsString()
  moduleKey!: string

  @ApiProperty({
    description: 'Free-form for now (e.g. psur, line_listing, batch_release, registration_renewal)',
  })
  @IsString()
  reportTypeKey!: string

  @ApiProperty()
  @IsString()
  @MaxLength(300)
  title!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  periodStart?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  periodEnd?: string

  @ApiPropertyOptional({
    description:
      'What this report is about, if it concerns one specific record (e.g. "product") — omit for a company-wide report',
  })
  @IsOptional()
  @IsString()
  recordType?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  recordId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueAt?: string
}
