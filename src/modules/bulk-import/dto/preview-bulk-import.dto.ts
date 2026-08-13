import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString } from 'class-validator'

export class PreviewBulkImportDto {
  @ApiProperty({ description: 'Raw CSV text, header row included' })
  @IsString()
  @IsNotEmpty()
  csvText: string
}
