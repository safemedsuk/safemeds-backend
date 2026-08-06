import { IsEmail, Length } from 'class-validator'

export class VerifyEmailDto {
  @IsEmail()
  email!: string

  @Length(6, 6)
  code!: string
}
