import { IsIn } from 'class-validator'

/** Supported UI display locales — see todo-i18n.md. Adding a language later is just adding its code here. */
export const SUPPORTED_LOCALES = ['en', 'fr'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export class UpdatePreferredLocaleDto {
  @IsIn(SUPPORTED_LOCALES)
  preferredLocale!: SupportedLocale
}
