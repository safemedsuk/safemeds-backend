import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsArray, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator'

export class CreateRecallEffectivenessCheckDto {
  @IsString()
  @MinLength(1)
  method!: string

  @IsInt()
  @Min(1)
  sampleSize!: number

  @IsInt()
  @Min(0)
  clear!: number

  @IsInt()
  @Min(0)
  stockFound!: number

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  followUpTaskIds?: string[]
}
