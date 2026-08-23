import { IsUUID } from 'class-validator'

export class AttachPromotionalMaterialDocumentDto {
  @IsUUID()
  documentId!: string
}
