import { IsOptional, IsString } from 'class-validator'

/**
 * testing-correction-explanation.md §4.1 — up to 3 independent CSV
 * bodies in one request, each optional (a client with one combined file
 * puts manufacturer/site/local-rep columns all in the Manufacturers
 * file; a client with three separate files sends all three). This is
 * exactly the shape `preview()`/`commit()` both share — the same DTO
 * works for both endpoints.
 */
export class RegEntitiesImportPreviewDto {
  @IsOptional()
  @IsString()
  manufacturersCsv?: string

  @IsOptional()
  @IsString()
  sitesCsv?: string

  @IsOptional()
  @IsString()
  localRepresentativesCsv?: string
}

export class RegEntitiesImportCommitDto {
  @IsOptional()
  manufacturers?: Record<string, string>[]

  @IsOptional()
  sites?: Record<string, string>[]

  @IsOptional()
  localRepresentatives?: Record<string, string>[]
}
