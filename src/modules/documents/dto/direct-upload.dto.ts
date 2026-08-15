import { IsOptional, IsString, IsUUID, Length } from 'class-validator'

/**
 * Multipart form fields alongside the `file` field itself — see
 * `DocumentsController.uploadDirect()`. Same semantics as
 * `CreateDocumentUploadDto`'s `documentId`/`title` (omit `documentId` to
 * create a brand-new `Document`, in which case `title` is required;
 * supply `documentId` to instead add a new version under an existing one).
 */
export class DirectUploadDto {
  @IsOptional()
  @IsUUID()
  documentId?: string

  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string
}
