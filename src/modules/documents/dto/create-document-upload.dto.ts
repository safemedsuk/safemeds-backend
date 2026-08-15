import { IsOptional, IsString, IsUUID, Length } from 'class-validator'

export class CreateDocumentUploadDto {
  /**
   * Omit to create a brand-new Document (title required in that case);
   * supply an existing document's id to instead register a new version
   * under it (must belong to the same record — checked server-side).
   */
  @IsOptional()
  @IsUUID()
  documentId?: string

  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string

  @IsString()
  filename!: string

  @IsString()
  contentType!: string
}
