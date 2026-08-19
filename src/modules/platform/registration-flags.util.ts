const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'icloud.com',
  'protonmail.com',
  'aol.com',
  'live.com',
])

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(ltd|limited|inc|incorporated|llc|plc|pharmacy|pharmaceuticals?|company|co)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
}

export interface RegistrationFlags {
  freeMailDomain: boolean
  domainNameMismatch: boolean
}

/** Cheap heuristics to help a reviewer spot a registration worth a closer look — not a hard block. */
export function computeRegistrationFlags(
  companyName: string,
  adminEmail: string,
): RegistrationFlags {
  const domain = adminEmail.split('@')[1]?.toLowerCase() ?? ''
  const freeMailDomain = FREE_MAIL_DOMAINS.has(domain)

  const domainRoot = normalize(domain.split('.')[0] ?? '')
  const normalizedCompanyName = normalize(companyName)

  const domainNameMismatch =
    !freeMailDomain &&
    domainRoot.length >= 3 &&
    normalizedCompanyName.length >= 3 &&
    !normalizedCompanyName.includes(domainRoot) &&
    !domainRoot.includes(normalizedCompanyName)

  return { freeMailDomain, domainNameMismatch }
}
