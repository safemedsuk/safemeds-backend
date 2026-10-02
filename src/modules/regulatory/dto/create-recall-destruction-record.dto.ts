import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator'

export class CreateRecallDestructionRecordDto {
  @IsInt()
  @Min(1)
  units!: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  disposalApprovalEvidenceId?: string
}
