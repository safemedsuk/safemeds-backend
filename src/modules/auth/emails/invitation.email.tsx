import { Button, Text } from '@react-email/components';
import * as React from 'react';

import { t } from '../../../common/i18n/email-messages';
import { DEFAULT_LOCALE, SupportedLocale } from '../../../common/i18n/locale';
import { EmailLayout } from './layout';

interface InvitationEmailProps {
  companyName: string;
  inviterName: string;
  roleLabels: string[];
  acceptUrl: string;
  expiresInDays: number;
  recipientEmail: string;
  locale?: SupportedLocale;
}

export function InvitationEmail({
  companyName,
  inviterName,
  roleLabels,
  acceptUrl,
  expiresInDays,
  recipientEmail,
  locale = DEFAULT_LOCALE,
}: InvitationEmailProps): React.ReactElement {
  const isPlural = roleLabels.length > 1;
  return (
    <EmailLayout
      previewText={t(locale, 'invitation.previewText', { inviterName, companyName })}
      heading={t(locale, 'invitation.heading')}
      eyebrow={t(locale, 'invitation.eyebrow')}
      recipientEmail={recipientEmail}
      locale={locale}
    >
      <Text style={{ fontSize: '14px', color: '#3f3f46', lineHeight: '22px', margin: '0 0 16px' }}>
        <strong>{inviterName}</strong> {t(locale, isPlural ? 'invitation.bodyPluralMid' : 'invitation.bodySingularMid')} <strong>{companyName}</strong>{' '}
        {t(locale, isPlural ? 'invitation.bodyPluralSuffix' : 'invitation.bodySingularSuffix')}
      </Text>
      <table role="presentation" cellPadding={0} cellSpacing={0} style={{ margin: '0 0 20px' }}>
        <tbody>
          <tr>
            <td>
              {roleLabels.map((label) => (
                <span
                  key={label}
                  style={{
                    display: 'inline-block',
                    backgroundColor: '#f0fdfa',
                    color: '#0f766e',
                    border: '1px solid #99f6e4',
                    borderRadius: '999px',
                    padding: '4px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    marginRight: '6px',
                    marginBottom: '6px',
                  }}
                >
                  {label}
                </span>
              ))}
            </td>
          </tr>
        </tbody>
      </table>
      <Button
        href={acceptUrl}
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
        {t(locale, 'invitation.button')}
      </Button>
      <Text style={{ fontSize: '13px', color: '#71717a', margin: '20px 0 0' }}>
        {t(locale, 'invitation.footer', { days: String(expiresInDays) })}
      </Text>
    </EmailLayout>
  );
}
