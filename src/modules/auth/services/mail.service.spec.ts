import { Logger } from '@nestjs/common'

import { MailService } from './mail.service'

function buildConfigService(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    RESEND_API_KEY: 're_dev_placeholder_not_a_real_key',
    MAIL_FROM_NAME: 'SafeMeds',
    MAIL_FROM_ADDRESS: 'noreply@safemeds.test',
    ...overrides,
  }
  return { get: jest.fn((key: string) => values[key]) } as never
}

/**
 * testing-todo Stage 11.2 — this only exercises the placeholder-key
 * detection at construction time (a plain string check with no network
 * call), not `send()`/`dispatch()` themselves — those need a real
 * `Resend` client and `@react-email/render()`, which is exactly the
 * Jest/ESM combination `MailService`'s own doc comment (and this same
 * task) already documents as untestable inside this project's Jest
 * environment. Real coverage for the actual send path is the existing
 * e2e suites' own best-effort real-server exercise.
 */
describe('MailService — placeholder-key detection (Stage 11.2)', () => {
  it('warns once at construction when RESEND_API_KEY is the dev/test placeholder', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    new MailService(buildConfigService())

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('RESEND_API_KEY is the dev/test placeholder value'),
    )
    warnSpy.mockRestore()
  })

  it('does not warn for a real-looking API key', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    new MailService(buildConfigService({ RESEND_API_KEY: 're_test_1234567890ABCDEFGHIJKLMNOP' }))

    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
