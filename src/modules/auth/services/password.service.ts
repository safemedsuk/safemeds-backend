import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as argon2 from 'argon2'

import { EnvConfig } from '../../../config/env.validation'

const SPECIAL_CHARS = /[!@#$%^&*]/

export interface PasswordPolicyContext {
  fullName?: string
  companyName?: string
  /**
   * Overrides the platform-floor `PASSWORD_MIN_LENGTH` — pass the caller's
   * company's `SecurityPolicy.minPasswordLength` here wherever a company
   * is known (invitation accept, reset, change). Deliberately never
   * applied retroactively to a password someone already has: raising a
   * company's policy only affects *new* passwords going forward, nothing
   * re-validates an existing login against the current policy.
   */
  minLength?: number
}

/**
 * Mirrors the FE checklist in `app/register/page.tsx`'s
 * PASSWORD_REQUIREMENTS exactly, so client and server never disagree
 * about what a valid password is.
 */
@Injectable()
export class PasswordService {
  constructor(private readonly configService: ConfigService<EnvConfig, true>) {}

  async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: this.configService.get('ARGON2_MEMORY_COST_KB', { infer: true }),
      timeCost: this.configService.get('ARGON2_TIME_COST', { infer: true }),
      parallelism: this.configService.get('ARGON2_PARALLELISM', { infer: true }),
    })
  }

  verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password)
  }

  /** Returns the list of violated rule messages; empty array means valid. */
  checkPolicy(password: string, context: PasswordPolicyContext = {}): string[] {
    const platformFloor = this.configService.get('PASSWORD_MIN_LENGTH', { infer: true })
    const minLength = context.minLength ?? platformFloor
    const violations: string[] = []

    if (password.length < minLength) {
      violations.push(`Password must be at least ${minLength} characters`)
    }
    if (!/[A-Z]/.test(password)) {
      violations.push('Password must contain an uppercase letter')
    }
    if (!/[a-z]/.test(password)) {
      violations.push('Password must contain a lowercase letter')
    }
    if (!/\d/.test(password)) {
      violations.push('Password must contain a number')
    }
    if (!SPECIAL_CHARS.test(password)) {
      violations.push('Password must contain a special character (!@#$%^&*)')
    }

    const lowerPassword = password.toLowerCase()
    if (context.fullName) {
      const nameParts = context.fullName
        .toLowerCase()
        .split(/\s+/)
        .filter((part) => part.length >= 3)
      if (nameParts.some((part) => lowerPassword.includes(part))) {
        violations.push('Password must not contain your name')
      }
    }
    if (context.companyName) {
      const companyParts = context.companyName
        .toLowerCase()
        .split(/\s+/)
        .filter((part) => part.length >= 3)
      if (companyParts.some((part) => lowerPassword.includes(part))) {
        violations.push('Password must not contain your company name')
      }
    }

    return violations
  }

  assertPolicy(password: string, context: PasswordPolicyContext = {}): void {
    const violations = this.checkPolicy(password, context)
    if (violations.length > 0) {
      throw new BadRequestException({ message: violations, error: 'Password policy violation' })
    }
  }
}
