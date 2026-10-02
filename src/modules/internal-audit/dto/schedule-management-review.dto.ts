import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator'

export class ScheduleManagementReviewDto {
  @IsString()
  @MinLength(1)
  period!: string

  @IsDateString()
  reviewDate!: string

  @IsOptional()
  @IsString()
  attendees?: string

  @IsOptional()
  @IsDateString()
  nextReviewDueAt?: string
}
