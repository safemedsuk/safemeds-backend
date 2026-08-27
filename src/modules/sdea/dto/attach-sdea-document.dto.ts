import { IsString } from 'class-validator'

export class AttachSdeaDocumentDto {
  @IsString()
  documentId!: string
}
