import { IsUUID } from 'class-validator'

export class AttachDistributorTrainingCertificateDto {
  @IsUUID()
  documentId!: string
}
