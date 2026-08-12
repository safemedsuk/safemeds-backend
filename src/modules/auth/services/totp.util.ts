import { generateSecret, generateURI, verify } from 'otplib'

export function generateTotpSecret(): string {
  return generateSecret()
}

export function generateTotpUri(issuer: string, label: string, secret: string): string {
  return generateURI({ issuer, label, secret })
}

/** 30s tolerance either side absorbs minor client/server clock drift without weakening the window meaningfully. */
export async function verifyTotpCode(secret: string, token: string): Promise<boolean> {
  const result = await verify({ secret, token, epochTolerance: 30 })
  return result.valid
}
