import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator'

export class UpdateSecurityPolicyDto {
  @IsOptional()
  @IsInt()
  @Min(12, { message: 'minPasswordLength cannot be set below the platform floor of 12' })
  minPasswordLength?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  sessionTimeoutMinutes?: number

  @IsOptional()
  @IsBoolean()
  mfaRequiredForSignatureRoles?: boolean
}
