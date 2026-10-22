import { IsOptional, IsString, Length } from 'class-validator'

/** Pass B (item E) — one attendee of a management review, entered by name. Never a UUID, never a free-text blob. */
export class ManagementReviewAttendeeDto {
  @IsString()
  @Length(2, 120)
  name!: string

  @IsOptional()
  @IsString()
  @Length(0, 200)
  roleOrOrganisation?: string
}

export class AddManagementReviewAttendeeDto extends ManagementReviewAttendeeDto {}
