import { IsString, MinLength } from 'class-validator'

export class RejectRegistrationDto {
  @IsString()
  @MinLength(3)
  reason!: string
}
