import { PlatformRole } from '@prisma/client'

export interface AuthenticatedUser {
  sub: string
  companyId: string | null
  roleKeys: string[]
  platformRole: PlatformRole | null
  tokenVersion: number
}
