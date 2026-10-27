import { Text } from '@react-email/components';
import * as React from 'react';

import { t } from '../../../common/i18n/email-messages';
import { DEFAULT_LOCALE, SupportedLocale } from '../../../common/i18n/locale';
import { EmailLayout } from './layout';

interface VerificationCodeEmailProps {
  code: string;
  expiresInMinutes: number;
  recipientEmail: string;
  locale?: SupportedLocale;
}

export function VerificationCodeEmail({
  code,
  expiresInMinutes,
  recipientEmail,
  locale = DEFAULT_LOCALE,
}: VerificationCodeEmailProps): React.ReactElement {
  return (
    <EmailLayout
      previewText={t(locale, 'verificationCode.previewText', { code })}
      heading={t(locale, 'verificationCode.heading')}
      eyebrow={t(locale, 'verificationCode.eyebrow')}
      recipientEmail={recipientEmail}
      locale={locale}
    >
      <Text style={{ fontSize: '14px', color: '#3f3f46', lineHeight: '22px', margin: '0 0 20px' }}>
        {t(locale, 'verificationCode.body')}
      </Text>
      <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
        <tbody>
          <tr>
            <td
              style={{
                backgroundColor: '#f0fdfa',
                border: '1px solid #99f6e4',
                borderRadius: '10px',
                padding: '20px',
                textAlign: 'center',
              }}
            >
              <Text
                style={{
                  fontSize: '34px',
                  fontWeight: 700,
                  letterSpacing: '0.3em',
                  color: '#1e3a3a',
                  margin: 0,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              >
                {code}
              </Text>
            </td>
          </tr>
        </tbody>
      </table>
      <Text style={{ fontSize: '13px', color: '#71717a', margin: '20px 0 0' }}>
        {t(locale, 'verificationCode.footer', { minutes: String(expiresInMinutes) })}
      </Text>
    </EmailLayout>
  );
}
