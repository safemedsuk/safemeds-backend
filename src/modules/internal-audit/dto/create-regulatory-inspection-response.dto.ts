import { IsDateString, IsOptional, IsUUID } from 'class-validator'

export class CreateRegulatoryInspectionResponseDto {
  @IsOptional()
  @IsUUID('7')
  findingId?: string

  @IsOptional()
  @IsDateString()
  responseDueDate?: string
}
