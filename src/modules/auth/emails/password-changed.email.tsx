import { Text } from '@react-email/components';
import * as React from 'react';

import { EmailLayout } from './layout';

interface PasswordChangedEmailProps {
  recipientEmail: string;
  occurredAt: string;
}

export function PasswordChangedEmail({
  recipientEmail,
  occurredAt,
}: PasswordChangedEmailProps): React.ReactElement {
  return (
    <EmailLayout
      previewText="Your SafeMeds password was changed"
      heading="Your password was changed"
      eyebrow="Security alert"
      recipientEmail={recipientEmail}
    >
      <Text style={{ fontSize: '14px', color: '#3f3f46', lineHeight: '22px', margin: '0 0 16px' }}>
        The password for your SafeMeds account was changed on <strong>{occurredAt}</strong>. All other sessions
        and devices have been signed out as a precaution.
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
                If this wasn't you, contact your company administrator immediately — your account may be
                compromised.
              </Text>
            </td>
          </tr>
        </tbody>
      </table>
    </EmailLayout>
  );
}
