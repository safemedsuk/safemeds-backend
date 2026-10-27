import { Button, Text } from '@react-email/components';
import * as React from 'react';

import { t } from '../../../common/i18n/email-messages';
import { DEFAULT_LOCALE, SupportedLocale } from '../../../common/i18n/locale';
import { EmailLayout } from './layout';

interface ApprovalEmailProps {
  companyName: string;
  loginUrl: string;
  recipientEmail: string;
  locale?: SupportedLocale;
}

export function ApprovalEmail({ companyName, loginUrl, recipientEmail, locale = DEFAULT_LOCALE }: ApprovalEmailProps): React.ReactElement {
  return (
    <EmailLayout
      previewText={t(locale, 'approval.previewText')}
      heading={t(locale, 'approval.heading')}
      eyebrow={t(locale, 'approval.eyebrow')}
      recipientEmail={recipientEmail}
      locale={locale}
    >
      <Text style={{ fontSize: '14px', color: '#3f3f46', lineHeight: '22px', margin: '0 0 20px' }}>
        {t(locale, 'approval.bodyPrefix')}
        <strong>{companyName}</strong> {t(locale, 'approval.bodySuffix')}
      </Text>
      <Button
        href={loginUrl}
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
        {t(locale, 'approval.button')}
      </Button>
      <Text style={{ fontSize: '13px', color: '#71717a', margin: '20px 0 0' }}>
        {t(locale, 'approval.footer')}
      </Text>
    </EmailLayout>
  );
}
