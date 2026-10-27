import { Button, Text } from '@react-email/components';
import * as React from 'react';

import { t } from '../../../common/i18n/email-messages';
import { DEFAULT_LOCALE, SupportedLocale } from '../../../common/i18n/locale';
import { EmailLayout } from './layout';

interface PasswordResetEmailProps {
  resetUrl: string;
  expiresInMinutes: number;
  recipientEmail: string;
  locale?: SupportedLocale;
}

export function PasswordResetEmail({
  resetUrl,
  expiresInMinutes,
  recipientEmail,
  locale = DEFAULT_LOCALE,
}: PasswordResetEmailProps): React.ReactElement {
  return (
    <EmailLayout
      previewText={t(locale, 'passwordReset.previewText')}
      heading={t(locale, 'passwordReset.heading')}
      eyebrow={t(locale, 'passwordReset.eyebrow')}
      recipientEmail={recipientEmail}
      locale={locale}
    >
      <Text style={{ fontSize: '14px', color: '#3f3f46', lineHeight: '22px', margin: '0 0 20px' }}>
        {t(locale, 'passwordReset.body')}
      </Text>
      <Button
        href={resetUrl}
        style={{
          backgroundColor: '#0f766e',
          color: '#ffffff',
          padding: '13px 22px',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: 600,
          display: 'inline-block',
        }}
      >
        {t(locale, 'passwordReset.button')}
      </Button>
      <Text style={{ fontSize: '13px', color: '#71717a', margin: '20px 0 0' }}>
        {t(locale, 'passwordReset.footer', { minutes: String(expiresInMinutes) })}
      </Text>
    </EmailLayout>
  );
}
