import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator'

export class AssignReadersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  userIds!: string[]
}
