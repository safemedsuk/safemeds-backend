import { IsOptional, IsString, IsUUID } from 'class-validator'

/** Starts the real per-authority dossier for one of a reliance application's participating (or lead) authorities — see `RelianceApplicationService.startDossierForAuthority()`. */
export class StartAuthorityDossierDto {
  @IsUUID()
  authorityId!: string

  @IsString()
  productClass!: string

  @IsOptional()
  @IsString()
  route?: string
}
