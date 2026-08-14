import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ContactTestAttemptOutcome } from '@prisma/client'
import { IsEnum, IsOptional, IsString } from 'class-validator'

export class LogContactTestAttemptDto {
  @ApiProperty({ enum: ContactTestAttemptOutcome })
  @IsEnum(ContactTestAttemptOutcome)
  outcome: ContactTestAttemptOutcome

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string
}
