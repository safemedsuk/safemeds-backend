import { ApiProperty } from '@nestjs/swagger'
import { IsUUID } from 'class-validator'

export class LinkSourceDocumentDto {
  @ApiProperty({
    description:
      "An existing Document (already uploaded via POST /records/pv_case/:caseId/documents and completed) to attach as this case's source artifact",
  })
  @IsUUID()
  documentId: string
}
