import { Button, Text } from '@react-email/components';
import * as React from 'react';

import { EmailLayout } from './layout';

interface InvitationEmailProps {
  companyName: string;
  inviterName: string;
  roleLabels: string[];
  acceptUrl: string;
  expiresInDays: number;
  recipientEmail: string;
}

export function InvitationEmail({
  companyName,
  inviterName,
  roleLabels,
  acceptUrl,
  expiresInDays,
  recipientEmail,
}: InvitationEmailProps): React.ReactElement {
  return (
    <EmailLayout
      previewText={`${inviterName} invited you to join ${companyName} on SafeMeds`}
      heading="You've been invited to SafeMeds"
      eyebrow="Team invitation"
      recipientEmail={recipientEmail}
    >
      <Text style={{ fontSize: '14px', color: '#3f3f46', lineHeight: '22px', margin: '0 0 16px' }}>
        <strong>{inviterName}</strong> has invited you to join <strong>{companyName}</strong> on SafeMeds with the
        following role{roleLabels.length > 1 ? 's' : ''}:
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
        Accept invitation
      </Button>
      <Text style={{ fontSize: '13px', color: '#71717a', margin: '20px 0 0' }}>
        This invitation expires in {expiresInDays} days. If you weren't expecting this, you can safely ignore this
        email.
      </Text>
    </EmailLayout>
  );
}
