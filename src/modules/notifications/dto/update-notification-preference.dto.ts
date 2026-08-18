import { IsBoolean, IsOptional } from 'class-validator'

export class UpdateNotificationPreferenceDto {
  @IsOptional()
  @IsBoolean()
  emailTaskAssigned?: boolean

  @IsOptional()
  @IsBoolean()
  emailDeadline?: boolean

  @IsOptional()
  @IsBoolean()
  emailWorkflowUpdate?: boolean
}
