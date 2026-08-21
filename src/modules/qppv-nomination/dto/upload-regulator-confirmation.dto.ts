import { IsString } from 'class-validator'

export class UploadRegulatorConfirmationDto {
  @IsString()
  documentId!: string
}
