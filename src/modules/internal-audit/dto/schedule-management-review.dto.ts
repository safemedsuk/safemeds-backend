import { Type } from 'class-transformer'
import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator'

import { ManagementReviewAttendeeDto } from './management-review-attendee.dto'

export class ScheduleManagementReviewDto {
  @IsString()
  @MinLength(1)
  period!: string

  @IsDateString()
  reviewDate!: string

  /** Legacy single-string attendee list, kept so reviews created before Pass B still read back. Prefer `attendeeRows`. */
  @IsOptional()
  @IsString()
  attendees?: string

  /** Pass B (item E) — structured attendee rows, one per person, added and removed independently afterwards. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManagementReviewAttendeeDto)
  attendeeRows?: ManagementReviewAttendeeDto[]

  @IsOptional()
  @IsDateString()
  nextReviewDueAt?: string
}
