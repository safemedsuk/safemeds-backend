import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator'

/**
 * VigiCloud Stage 19 — "Log a literature-monitoring run." Per the user's
 * own explicit instruction, this is never a search-API call — a staff
 * member performs their own search (PubMed, a journal, etc.) outside
 * this system and records what they did here afterward.
 */
export class LogLiteratureRunDto {
  @ApiProperty()
  @IsDateString()
  runAt: string

  @ApiProperty({
    description: 'e.g. "PubMed manual search", "Monthly journal review — Drug Safety"',
  })
  @IsString()
  @IsNotEmpty()
  method: string

  @ApiProperty({ description: 'What was actually searched for' })
  @IsString()
  @IsNotEmpty()
  searchTerms: string

  @ApiProperty()
  @IsInt()
  @Min(0)
  hitsCount: number

  @ApiPropertyOptional({ description: "What was found, in the reviewer's own words" })
  @IsOptional()
  @IsString()
  hitsSummary?: string
}
