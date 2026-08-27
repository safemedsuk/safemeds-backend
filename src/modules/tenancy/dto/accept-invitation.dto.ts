import { IsString, MinLength } from 'class-validator'

export class AcceptInvitationDto {
  @IsString()
  @MinLength(2)
  fullName!: string

  @IsString()
  password!: string
}
