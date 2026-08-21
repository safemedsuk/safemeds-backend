import { IsString, Matches, MinLength } from 'class-validator'

export class CreatePermissionDto {
  /** `domain.action`, matching every existing permission's own shape (e.g. "pv.sign_icsr"). */
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, {
    message: 'key must be lowercase "domain.action" (e.g. "pv.sign_icsr")',
  })
  key!: string

  @IsString()
  @MinLength(1)
  description!: string
}
