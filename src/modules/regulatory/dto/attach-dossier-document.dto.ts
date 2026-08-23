import { IsUUID } from 'class-validator'

export class AttachDossierDocumentDto {
  @IsUUID()
  documentId!: string
}
