import { Button, Text } from '@react-email/components';
import * as React from 'react';

import { EmailLayout } from './layout';

interface ApprovalEmailProps {
  companyName: string;
  loginUrl: string;
  recipientEmail: string;
}

export function ApprovalEmail({ companyName, loginUrl, recipientEmail }: ApprovalEmailProps): React.ReactElement {
  return (
    <EmailLayout
      previewText="Your SafeMeds registration has been approved"
      heading="Registration approved"
      eyebrow="Account approved"
      recipientEmail={recipientEmail}
    >
      <Text style={{ fontSize: '14px', color: '#3f3f46', lineHeight: '22px', margin: '0 0 20px' }}>
        Good news — <strong>{companyName}</strong> has been reviewed and approved on SafeMeds. You can now sign in
        with the administrator account you created during registration.
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
        Sign in to SafeMeds
      </Button>
      <Text style={{ fontSize: '13px', color: '#71717a', margin: '20px 0 0' }}>
        As a first step, we recommend enabling multi-factor authentication from Settings → Security to add an
        extra layer of protection to your account.
      </Text>
    </EmailLayout>
  );
}
