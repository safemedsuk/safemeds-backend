import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsOptional } from 'class-validator'

export class ApproveCapaDto {
  /**
   * "QA plus, where the action touches a regulated filing, a Reg-side
   * approver too" — set explicitly by the QA approver, never inferred.
   * `close()` additionally requires a real regulatory approval once
   * this is true.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresRegulatoryApproval?: boolean
}
