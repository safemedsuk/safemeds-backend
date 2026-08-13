import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsArray, IsObject } from 'class-validator'

export class CommitBulkImportDto {
  /**
   * Without `@Type(() => Object)`, the global `ValidationPipe`'s
   * `enableImplicitConversion` reflects this property's TS-erased
   * `design:type` (`Array`, since `Record<string,string>[]` collapses to
   * that at emit time) and `class-transformer` mis-converts each row
   * object into an actual `Array` instance with the row's fields attached
   * as extra properties — which then fails `@IsObject({ each: true })`
   * (an `Array` is not a plain object). Confirmed via a standalone repro
   * before this decorator was added.
   */
  @ApiProperty({
    description:
      'The mapped row objects to commit — normally exactly the `validRows` returned by the preview step',
    type: [Object],
  })
  @IsArray()
  @IsObject({ each: true })
  @Type(() => Object)
  rows: Record<string, string>[]
}
