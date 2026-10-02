import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export const RECALL_PORTAL_ACTIONS = [
  'ack',
  'stop_sale',
  'quarantine',
  'count',
  'downstream',
  'evidence',
  'return_request',
] as const

export class SubmitRecallPortalActionDto {
  @IsIn(RECALL_PORTAL_ACTIONS)
  action!: (typeof RECALL_PORTAL_ACTIONS)[number]

  @ApiPropertyOptional()
  @IsOptional()
  payload?: Record<string, unknown>

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  clientTimestamp?: string

  /** Makes a queued-then-synced offline action safe to resubmit on reconnect. */
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  idempotencyKey!: string
}
