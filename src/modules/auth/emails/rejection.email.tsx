import { Button, Text } from '@react-email/components';
import * as React from 'react';

import { t } from '../../../common/i18n/email-messages';
import { DEFAULT_LOCALE, SupportedLocale } from '../../../common/i18n/locale';
import { EmailLayout } from './layout';

interface RejectionEmailProps {
  companyName: string;
  reason: string;
  registerUrl: string;
  recipientEmail: string;
  locale?: SupportedLocale;
}

export function RejectionEmail({
  companyName,
  reason,
  registerUrl,
  recipientEmail,
  locale = DEFAULT_LOCALE,
}: RejectionEmailProps): React.ReactElement {
  return (
    <EmailLayout
      previewText={t(locale, 'rejection.previewText')}
      heading={t(locale, 'rejection.heading')}
      eyebrow={t(locale, 'rejection.eyebrow')}
      recipientEmail={recipientEmail}
      locale={locale}
    >
      <Text style={{ fontSize: '14px', color: '#3f3f46', lineHeight: '22px', margin: '0 0 16px' }}>
        {t(locale, 'rejection.bodyLeadPrefix')}
        <strong>{companyName}</strong>
        {t(locale, 'rejection.bodyLeadSuffix')}
      </Text>
      <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
        <tbody>
          <tr>
            <td
              style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '10px',
                padding: '16px',
              }}
            >
              <Text style={{ fontSize: '14px', color: '#7f1d1d', margin: 0, lineHeight: '20px' }}>{reason}</Text>
            </td>
          </tr>
        </tbody>
      </table>
      <Text style={{ fontSize: '14px', color: '#3f3f46', lineHeight: '22px', margin: '20px 0 16px' }}>
        {t(locale, 'rejection.bodyFollowUp')}
      </Text>
      <Button
        href={registerUrl}
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
        {t(locale, 'rejection.button')}
      </Button>
    </EmailLayout>
  );
}
