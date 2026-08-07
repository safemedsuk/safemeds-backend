import { Button, Text } from '@react-email/components';
import * as React from 'react';

import { EmailLayout } from './layout';

interface RejectionEmailProps {
  companyName: string;
  reason: string;
  registerUrl: string;
  recipientEmail: string;
}

export function RejectionEmail({
  companyName,
  reason,
  registerUrl,
  recipientEmail,
}: RejectionEmailProps): React.ReactElement {
  return (
    <EmailLayout
      previewText="Your SafeMeds registration was not approved"
      heading="Registration not approved"
      eyebrow="Registration decision"
      recipientEmail={recipientEmail}
    >
      <Text style={{ fontSize: '14px', color: '#3f3f46', lineHeight: '22px', margin: '0 0 16px' }}>
        We were unable to approve the registration for <strong>{companyName}</strong>.
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
        You're welcome to submit a new registration once the issue above is corrected — reference numbers aren't
        reused, so this starts a fresh review.
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
        Submit a new registration
      </Button>
    </EmailLayout>
  );
}
