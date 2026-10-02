import { IsDateString, IsOptional, IsUUID } from 'class-validator'

/** CEO feedback, 30 Sep 2026 — "Response due date... entered manually for now." A dedicated PATCH rather than folding onto `CreateRegQueryDto`, since the due date is commonly set/corrected after the letter is already logged. */
export class UpdateRegQueryDueDateDto {
  @IsDateString()
  responseDueDate!: string
}

/** CEO feedback, 30 Sep 2026 — "assign each query to a named person, with the option to reassign." `ownerUserId: null` explicitly un-assigns. */
export class AssignRegQueryOwnerDto {
  @IsOptional()
  @IsUUID('7')
  ownerUserId?: string | null
}
