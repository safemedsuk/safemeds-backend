import { IsString } from 'class-validator'

export class AttachTrainingCertificateDto {
  @IsString()
  documentId!: string
}
