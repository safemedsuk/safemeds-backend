import { Button, Text } from '@react-email/components';
import * as React from 'react';

import { EmailLayout } from './layout';

interface PasswordResetEmailProps {
  resetUrl: string;
  expiresInMinutes: number;
  recipientEmail: string;
}

export function PasswordResetEmail({
  resetUrl,
  expiresInMinutes,
  recipientEmail,
}: PasswordResetEmailProps): React.ReactElement {
  return (
    <EmailLayout
      previewText="Reset your SafeMeds password"
      heading="Reset your password"
      eyebrow="Password reset requested"
      recipientEmail={recipientEmail}
    >
      <Text style={{ fontSize: '14px', color: '#3f3f46', lineHeight: '22px', margin: '0 0 20px' }}>
        We received a request to reset the password for your SafeMeds account. Click below to choose a new one.
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
        Reset my password
      </Button>
      <Text style={{ fontSize: '13px', color: '#71717a', margin: '20px 0 0' }}>
        This link expires in {expiresInMinutes} minutes and can only be used once. If you didn't request a
        password reset, no action is needed — your password will not be changed and you can safely ignore this
        email.
      </Text>
    </EmailLayout>
  );
}
