import { IsEmail } from 'class-validator'

export class ResendInvitationVerificationDto {
  @IsEmail()
  email!: string
}
