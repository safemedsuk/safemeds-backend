import { IsIn, IsString } from 'class-validator'

const ROLES = ['primary', 'backup'] as const

export class SetQppvNominationDto {
  @IsIn(ROLES)
  role!: (typeof ROLES)[number]

  @IsString()
  qppvUserId!: string
}
