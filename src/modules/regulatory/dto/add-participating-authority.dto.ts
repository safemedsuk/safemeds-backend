import { IsUUID } from 'class-validator'

export class AddParticipatingAuthorityDto {
  @IsUUID()
  authorityId!: string
}
