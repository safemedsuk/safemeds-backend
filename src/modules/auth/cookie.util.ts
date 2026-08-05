import { ConfigService } from '@nestjs/config'
import type { CookieOptions, Response } from 'express'

import { EnvConfig } from '../../config/env.validation'

const ACCESS_TOKEN_COOKIE = 'access_token'
const REFRESH_TOKEN_COOKIE = 'refresh_token'
const CSRF_COOKIE = 'csrf'
const AUTH_COOKIE_PATH = '/api/v1/auth'

function parseDurationToMs(duration: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(duration)
  if (!match) {
    throw new Error(`Cannot parse duration "${duration}"`)
  }
  const value = Number(match[1])
  const unitMs: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return value * unitMs[match[2]]
}

function baseCookieOptions(configService: ConfigService<EnvConfig, true>): CookieOptions {
  return {
    httpOnly: true,
    secure: configService.get('COOKIE_SECURE', { infer: true }),
    sameSite: 'lax',
    domain: configService.get('COOKIE_DOMAIN', { infer: true }) || undefined,
  }
}

export function setAuthCookies(
  res: Response,
  configService: ConfigService<EnvConfig, true>,
  tokens: { accessToken: string; refreshToken: string; csrfToken: string; refreshExpiresAt: Date },
): void {
  const base = baseCookieOptions(configService)
  const accessMaxAgeMs = parseDurationToMs(
    configService.get('JWT_ACCESS_EXPIRES_IN', { infer: true }),
  )
  const refreshMaxAgeMs = tokens.refreshExpiresAt.getTime() - Date.now()

  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...base,
    maxAge: accessMaxAgeMs,
    path: '/',
  })
  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...base,
    maxAge: refreshMaxAgeMs,
    path: AUTH_COOKIE_PATH,
  })
  res.cookie(CSRF_COOKIE, tokens.csrfToken, {
    ...base,
    httpOnly: false,
    maxAge: refreshMaxAgeMs,
    path: '/',
  })
}

/**
 * Re-signs only the access-token cookie, leaving the refresh token (and its
 * expiry) untouched. Used by `change-password`: bumping `tokenVersion`
 * invalidates the current access token immediately, but the refresh token
 * and its session are deliberately preserved.
 */
export function setAccessTokenCookie(
  res: Response,
  configService: ConfigService<EnvConfig, true>,
  accessToken: string,
): void {
  const base = baseCookieOptions(configService)
  const accessMaxAgeMs = parseDurationToMs(
    configService.get('JWT_ACCESS_EXPIRES_IN', { infer: true }),
  )
  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, { ...base, maxAge: accessMaxAgeMs, path: '/' })
}

export function clearAuthCookies(
  res: Response,
  configService: ConfigService<EnvConfig, true>,
): void {
  const base = baseCookieOptions(configService)
  res.clearCookie(ACCESS_TOKEN_COOKIE, { ...base, path: '/' })
  res.clearCookie(REFRESH_TOKEN_COOKIE, { ...base, path: AUTH_COOKIE_PATH })
  res.clearCookie(CSRF_COOKIE, { ...base, httpOnly: false, path: '/' })
}

export function readRefreshTokenCookie(req: { cookies?: Record<string, string> }): string | null {
  return req.cookies?.[REFRESH_TOKEN_COOKIE] ?? null
}
