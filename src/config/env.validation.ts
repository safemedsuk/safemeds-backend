import { z } from 'zod'

/**
 * Every configurable value the engine needs lives here, validated at boot.
 * Nothing that could plausibly change between environments (a key, a secret,
 * a third-party integration, a token lifetime, a rate limit) is hardcoded
 * in application code — it is read from here instead. Add new variables to
 * this schema AND to `.env.example` in the same change; a variable that
 * exists in one but not the other is a bug.
 *
 * The app refuses to boot if this schema fails to parse `process.env`.
 */

const booleanFromString = z
  .string()
  .trim()
  .toLowerCase()
  .transform((val) => val === 'true' || val === '1')
  .pipe(z.boolean())

const optionalBoolean = (defaultValue: boolean) =>
  z.preprocess(
    (val) => (val === undefined || val === '' ? String(defaultValue) : val),
    booleanFromString,
  )

const csvList = z
  .string()
  .trim()
  .transform((val) =>
    val
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )

const optionalUrl = z.preprocess(
  (val) => (val === '' ? undefined : val),
  z.string().url().optional(),
)

export const envSchema = z.object({
  // ── Application ──────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  APP_URL: z.string().url().describe('Public URL this API is reachable at'),
  FRONTEND_URL: z.string().url().describe('Base URL of the SafeMeds frontend (CORS origin)'),
  API_PREFIX: z.string().default('api/v1'),

  // ── Database (Postgres via Prisma) ──────────────────────────────────
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(10),

  // ── Redis (BullMQ, caching, single-use token store) ─────────────────
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // ── JWT / session tokens ─────────────────────────────────────────────
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN_DAYS: z.coerce.number().int().positive().default(7),
  JWT_MFA_PENDING_SECRET: z
    .string()
    .min(32, 'JWT_MFA_PENDING_SECRET must be at least 32 characters'),
  JWT_MFA_PENDING_EXPIRES_IN: z.string().default('5m'),

  // ── Cookies & CSRF ────────────────────────────────────────────────────
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: optionalBoolean(true),
  CSRF_SECRET: z.string().min(32, 'CSRF_SECRET must be at least 32 characters'),

  // ── Password hashing (argon2id tuning) ───────────────────────────────
  ARGON2_MEMORY_COST_KB: z.coerce.number().int().positive().default(65536),
  ARGON2_TIME_COST: z.coerce.number().int().positive().default(3),
  ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(12).default(12),

  // ── MFA (TOTP secret encryption at rest) ─────────────────────────────
  MFA_ENCRYPTION_KEY: z
    .string()
    .length(64, 'MFA_ENCRYPTION_KEY must be a 64-character hex string (32 bytes for AES-256-GCM)'),

  // ── Re-authentication (signature-grade tokens) ───────────────────────
  REAUTH_TOKEN_EXPIRES_IN_MINUTES: z.coerce.number().int().positive().default(5),

  // ── Account lifecycle timing ──────────────────────────────────────────
  EMAIL_VERIFICATION_CODE_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  EMAIL_VERIFICATION_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  INVITATION_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  LOGIN_LOCKOUT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  LOGIN_LOCKOUT_DURATION_MINUTES: z.coerce.number().int().positive().default(15),

  // ── Rate limiting (global default + auth-specific overrides) ─────────
  THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  AUTH_THROTTLE_REGISTER_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(3),
  AUTH_THROTTLE_LOGIN_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  AUTH_THROTTLE_RESEND_CODE_SECONDS: z.coerce.number().int().positive().default(60),

  // ── Email (Resend) ────────────────────────────────────────────────────
  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required'),
  MAIL_FROM_ADDRESS: z.string().email().default('no-reply@safemeds.uk'),
  MAIL_FROM_NAME: z.string().default('SafeMeds'),

  // ── Object storage (Cloudflare R2, S3-compatible) ────────────────────
  R2_ACCOUNT_ID: z.string().min(1, 'R2_ACCOUNT_ID is required'),
  R2_ACCESS_KEY_ID: z.string().min(1, 'R2_ACCESS_KEY_ID is required'),
  R2_SECRET_ACCESS_KEY: z.string().min(1, 'R2_SECRET_ACCESS_KEY is required'),
  R2_BUCKET_NAME: z.string().min(1, 'R2_BUCKET_NAME is required'),
  R2_ENDPOINT: z.string().url('R2_ENDPOINT must be a valid S3-compatible endpoint URL'),
  R2_PUBLIC_URL: optionalUrl,
  UPLOAD_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(10),
  PRESIGNED_UPLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  PRESIGNED_DOWNLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  // ── Observability ──────────────────────────────────────────────────────
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SENTRY_DSN: optionalUrl,
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  // ── API docs ──────────────────────────────────────────────────────────
  SWAGGER_ENABLED: optionalBoolean(true),
  SWAGGER_PATH: z.string().default('api/docs'),

  // ── CORS ──────────────────────────────────────────────────────────────
  CORS_ADDITIONAL_ORIGINS: csvList.optional(),
})

export type EnvConfig = z.infer<typeof envSchema>

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config)

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')

    throw new Error(
      `❌ Invalid environment configuration. The application cannot start:\n${formatted}\n`,
    )
  }

  return result.data
}
