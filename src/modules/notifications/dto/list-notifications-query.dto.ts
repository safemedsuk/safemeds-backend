import { IsIn, IsOptional, IsString } from 'class-validator'

export class ListNotificationsQueryDto {
  /** UUID v7 cursor — returns rows strictly older than this id. Omit for the first page. */
  @IsOptional()
  @IsString()
  cursor?: string

  @IsOptional()
  @IsIn(['true', 'false'])
  unreadOnly?: string
}
