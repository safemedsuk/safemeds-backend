import { IsString, MaxLength, MinLength } from 'class-validator'

export class ResolveComplaintDto {
  @MinLength(1)
  @MaxLength(4000)
  @IsString()
  resolutionNote!: string
}
