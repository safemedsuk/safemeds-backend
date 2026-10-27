import { IsIn } from 'class-validator'

import { SUPPORTED_LOCALES, SupportedLocale } from '../../../common/i18n/locale'

/** Re-exported for backward compatibility with existing imports of this file — the canonical definition now lives in `src/common/i18n/locale.ts`, shared with the email-locale system. */
export { SUPPORTED_LOCALES }
export type { SupportedLocale }

export class UpdatePreferredLocaleDto {
  @IsIn(SUPPORTED_LOCALES)
  preferredLocale!: SupportedLocale
}
