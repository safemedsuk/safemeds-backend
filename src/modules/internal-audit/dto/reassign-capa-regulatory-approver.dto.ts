import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsUUID } from 'class-validator'

export class ReassignCapaRegulatoryApproverDto {
  @ApiProperty({ description: 'Must hold regulatory.manage_registrations.' })
  @IsNotEmpty()
  @IsUUID()
  regulatoryApproverUserId!: string
}
