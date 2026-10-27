import { Text } from '@react-email/components';
import * as React from 'react';

import { t } from '../../../common/i18n/email-messages';
import { DEFAULT_LOCALE, SupportedLocale } from '../../../common/i18n/locale';
import { EmailLayout } from './layout';

interface PasswordChangedEmailProps {
  recipientEmail: string;
  occurredAt: string;
  locale?: SupportedLocale;
}

export function PasswordChangedEmail({
  recipientEmail,
  occurredAt,
  locale = DEFAULT_LOCALE,
}: PasswordChangedEmailProps): React.ReactElement {
  return (
    <EmailLayout
      previewText={t(locale, 'passwordChanged.previewText')}
      heading={t(locale, 'passwordChanged.heading')}
      eyebrow={t(locale, 'passwordChanged.eyebrow')}
      recipientEmail={recipientEmail}
      locale={locale}
    >
      <Text style={{ fontSize: '14px', color: '#3f3f46', lineHeight: '22px', margin: '0 0 16px' }}>
        {t(locale, 'passwordChanged.bodyPrefix')}
        <strong>{occurredAt}</strong>. {t(locale, 'passwordChanged.bodySuffix')}
      </Text>
      <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
        <tbody>
          <tr>
            <td
              style={{
                backgroundColor: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '10px',
                padding: '16px',
              }}
            >
              <Text style={{ fontSize: '13px', color: '#78350f', margin: 0, lineHeight: '20px' }}>
                {t(locale, 'passwordChanged.warning')}
              </Text>
            </td>
          </tr>
        </tbody>
      </table>
    </EmailLayout>
  );
}
