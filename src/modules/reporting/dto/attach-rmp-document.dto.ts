import { IsString } from 'class-validator'

export class AttachRmpDocumentDto {
  @IsString()
  documentId!: string
}
