import { IsString } from 'class-validator'

export class AttachPsmfDocumentDto {
  @IsString()
  documentId!: string
}
