/**
 * Supported UI/output display locales — see todo-i18n.md. Adding a
 * language later is just adding its code here. Canonical source for
 * this type; `update-preferred-locale.dto.ts` re-exports it rather than
 * defining its own copy, since a user's chosen locale and the locale an
 * email renders in must always agree on what's valid.
 */
export const SUPPORTED_LOCALES = ['en', 'fr'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

/** New users, and any recipient we have no known locale for (pre-account, external), always get English — see todo-i18n.md decision 3. */
export const DEFAULT_LOCALE: SupportedLocale = 'en'

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/** Normalizes anything that might hold a user's `preferredLocale` (including `null`/`undefined`/a stale value) down to a real, valid `SupportedLocale`, defaulting to English rather than ever passing an unchecked string into a template. */
export function resolveLocale(value: string | null | undefined): SupportedLocale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE
}
