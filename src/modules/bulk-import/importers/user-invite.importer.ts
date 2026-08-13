import { Injectable } from '@nestjs/common'

import { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface'
import {
  resolveTenantRoleKey,
  TENANT_ROLE_LABELS,
  TenantRoleKey,
} from '../../../common/tenant-roles.const'
import { InvitationsService } from '../../tenancy/invitations.service'
import { Importer, ImporterColumn, RequestMeta } from './importer.interface'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A single row's "Superintendent Pharmacist; QPPV" (or "SUPERINTENDENT_PHARMACIST;QPPV") split into tokens — semicolon so a role name's own spaces never get misread as a second role. */
function splitRoleTokens(raw: string): string[] {
  return raw
    .split(';')
    .map((r) => r.trim())
    .filter(Boolean)
}

/**
 * Column shape: `email` and `roleKeys` (role names — either the friendly
 * label shown in "Add User", e.g. "Superintendent Pharmacist", or the
 * raw key, e.g. "SUPERINTENDENT_PHARMACIST" — either works, matched
 * case-insensitively via `resolveTenantRoleKey()`), semicolon-separated
 * for more than one role. Header spellings a real spreadsheet might use
 * are accepted too — see `aliases` below.
 */
@Injectable()
export class UserInviteImporter implements Importer {
  readonly importType = 'user_invite'
  readonly label = 'Bulk invite users'
  readonly requiredPermission = 'users.invite'
  readonly columns: ImporterColumn[] = [
    {
      key: 'email',
      label: 'Email',
      required: true,
      aliases: ['Email Address', 'E-mail', 'E-mail Address'],
    },
    {
      key: 'roleKeys',
      label: 'Role(s)',
      required: true,
      aliases: ['Role', 'Roles', 'Role Name', 'Role Names', 'User Role', 'User Roles'],
    },
  ]

  constructor(private readonly invitationsService: InvitationsService) {}

  validateRow(row: Record<string, string>): string[] {
    const errors: string[] = []

    if (!row.email || !EMAIL_PATTERN.test(row.email)) {
      errors.push('Invalid or missing email address')
    }

    const tokens = splitRoleTokens(row.roleKeys ?? '')
    if (tokens.length === 0) {
      errors.push(
        `At least one role is required — valid roles are: ${this.validRoleNamesForDisplay()}`,
      )
    } else {
      const unresolved = tokens.filter((token) => resolveTenantRoleKey(token) === null)
      if (unresolved.length > 0) {
        errors.push(
          `Unrecognized role(s): ${unresolved.map((t) => `"${t}"`).join(', ')} — valid roles are: ${this.validRoleNamesForDisplay()}`,
        )
      }
    }

    return errors
  }

  async commitRow(
    actor: AuthenticatedUser,
    row: Record<string, string>,
    meta: RequestMeta,
  ): Promise<void> {
    const roleKeys = splitRoleTokens(row.roleKeys)
      .map((token) => resolveTenantRoleKey(token))
      .filter((key): key is TenantRoleKey => key !== null)

    await this.invitationsService.create(actor, { email: row.email, roleKeys }, meta)
  }

  private validRoleNamesForDisplay(): string {
    return Object.values(TENANT_ROLE_LABELS).join(', ')
  }
}
