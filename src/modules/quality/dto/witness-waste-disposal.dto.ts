import { IsString, MinLength } from 'class-validator'

export class WitnessWasteDisposalDto {
  @IsString()
  @MinLength(1)
  intentStatement!: string

  @IsString()
  @MinLength(1)
  signatureToken!: string
}
