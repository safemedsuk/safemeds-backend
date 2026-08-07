import { Text } from '@react-email/components';
import * as React from 'react';

import { EmailLayout } from './layout';

interface VerificationCodeEmailProps {
  code: string;
  expiresInMinutes: number;
  recipientEmail: string;
}

export function VerificationCodeEmail({
  code,
  expiresInMinutes,
  recipientEmail,
}: VerificationCodeEmailProps): React.ReactElement {
  return (
    <EmailLayout
      previewText={`Your SafeMeds verification code is ${code}`}
      heading="Verify your email address"
      eyebrow="Verification code"
      recipientEmail={recipientEmail}
    >
      <Text style={{ fontSize: '14px', color: '#3f3f46', lineHeight: '22px', margin: '0 0 20px' }}>
        Enter this code to verify your email and continue setting up your SafeMeds account.
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
        This code expires in {expiresInMinutes} minutes and can only be used once. If you didn't request this,
        you can safely ignore this email — no account will be created without it.
      </Text>
    </EmailLayout>
  );
}
