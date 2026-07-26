import { validateEnv } from './env.validation'

const validEnv: Record<string, string> = {
  APP_URL: 'http://localhost:3001',
  FRONTEND_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_MFA_PENDING_SECRET: 'b'.repeat(32),
  CSRF_SECRET: 'c'.repeat(32),
  MFA_ENCRYPTION_KEY: 'd'.repeat(64),
  RESEND_API_KEY: 're_test',
  R2_ACCOUNT_ID: 'acc',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'bucket',
  R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
}

describe('validateEnv', () => {
  it('accepts a fully valid config and applies defaults', () => {
    const result = validateEnv(validEnv)

    expect(result.NODE_ENV).toBe('development')
    expect(result.PORT).toBe(3001)
    expect(result.API_PREFIX).toBe('api/v1')
  })

  it('throws with a readable message when a required variable is missing', () => {
    const withoutDatabaseUrl = { ...validEnv }
    delete withoutDatabaseUrl.DATABASE_URL

    expect(() => validateEnv(withoutDatabaseUrl)).toThrow(/DATABASE_URL/)
  })

  it('rejects a secret shorter than the minimum length', () => {
    expect(() => validateEnv({ ...validEnv, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    )
  })

  it('coerces boolean-like strings for COOKIE_SECURE', () => {
    expect(validateEnv({ ...validEnv, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true)
    expect(validateEnv({ ...validEnv, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false)
  })

  it('treats empty-string optional URLs (as left blank in .env) as unset, not invalid', () => {
    const result = validateEnv({ ...validEnv, SENTRY_DSN: '', R2_PUBLIC_URL: '' })

    expect(result.SENTRY_DSN).toBeUndefined()
    expect(result.R2_PUBLIC_URL).toBeUndefined()
  })

  it('still rejects a malformed (non-empty) optional URL', () => {
    expect(() => validateEnv({ ...validEnv, SENTRY_DSN: 'not-a-url' })).toThrow(/SENTRY_DSN/)
  })

  it('parses CORS_ADDITIONAL_ORIGINS as a trimmed list', () => {
    const result = validateEnv({
      ...validEnv,
      CORS_ADDITIONAL_ORIGINS: 'https://a.example.com, https://b.example.com',
    })

    expect(result.CORS_ADDITIONAL_ORIGINS).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ])
  })
})
