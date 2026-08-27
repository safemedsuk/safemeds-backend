import { InvitationStatus } from '@prisma/client'
import { IsEnum, IsOptional } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListInvitationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(InvitationStatus)
  status?: InvitationStatus
}
