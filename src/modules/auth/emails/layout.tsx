import { Body, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components';
import * as React from 'react';

import { LogoMark } from './logo-mark';

const BRAND_TEAL = '#0f766e';
const BRAND_SPRUCE = '#1e3a3a';
const INK = '#1c1917';
const MUTED = '#71717a';
const BORDER = '#e4e4e7';
const PAPER = '#f4f4f5';

interface EmailLayoutProps {
  previewText: string;
  heading: string;
  /** Shown top-right of the header as a small badge, e.g. "Security notice". Defaults to a generic one. */
  eyebrow?: string;
  recipientEmail?: string;
  /**
   * Special Corner SC-7 — `recipientEmail`'s trust-footer line originally
   * hardcoded "because it's associated with a SafeMeds account or
   * registration," which is simply false for the growing list of
   * recipients who never have an account at all (a reporter, a
   * distributor's SDEA contact, a DHCP-letter recipient — anything
   * routed through `NotificationsService.sendExternalEmail()`). Default
   * stays `'account'` so all 6 pre-existing auth templates are
   * unaffected; pass `'external'` for anyone without a SafeMeds login.
   */
  recipientContext?: 'account' | 'external';
  children: React.ReactNode;
}

export function EmailLayout({
  previewText,
  heading,
  eyebrow = 'Account security',
  recipientEmail,
  recipientContext = 'account',
  children,
}: EmailLayoutProps): React.ReactElement {
  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={{ backgroundColor: PAPER, fontFamily: 'Helvetica, Arial, sans-serif', margin: 0, padding: '32px 0' }}>
        <Container style={{ maxWidth: '480px', margin: '0 auto', padding: '0 24px' }}>
          {/* Header: logo + wordmark, brand-consistent with the app */}
          <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ marginBottom: '20px' }}>
            <tbody>
              <tr>
                <td style={{ verticalAlign: 'middle' }}>
                  <table role="presentation" cellPadding={0} cellSpacing={0}>
                    <tbody>
                      <tr>
                        <td style={{ paddingRight: '10px', verticalAlign: 'middle' }}>
                          <LogoMark />
                        </td>
                        <td style={{ verticalAlign: 'middle' }}>
                          <Text style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: BRAND_SPRUCE }}>
                            SafeMeds
                          </Text>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
                <td style={{ textAlign: 'right', verticalAlign: 'middle' }}>
                  <Text
                    style={{
                      margin: 0,
                      fontSize: '11px',
                      fontWeight: 600,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      color: BRAND_TEAL,
                    }}
                  >
                    {eyebrow}
                  </Text>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Card */}
          <Section
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '14px',
              border: `1px solid ${BORDER}`,
              overflow: 'hidden',
            }}
          >
            <div style={{ height: '4px', backgroundColor: BRAND_TEAL }} />
            <div style={{ padding: '32px' }}>
              <Text style={{ fontSize: '20px', fontWeight: 700, color: INK, margin: '0 0 16px' }}>{heading}</Text>
              {children}
            </div>
          </Section>

          {/* Trust footer */}
          <Section style={{ padding: '20px 4px 0' }}>
            {recipientEmail && recipientContext === 'account' && (
              <Text style={{ fontSize: '12px', color: MUTED, margin: '0 0 8px' }}>
                This email was sent to <strong>{recipientEmail}</strong> because it's associated with a SafeMeds
                account or registration.
              </Text>
            )}
            {recipientEmail && recipientContext === 'external' && (
              <Text style={{ fontSize: '12px', color: MUTED, margin: '0 0 8px' }}>
                This email was sent to <strong>{recipientEmail}</strong> because a company using SafeMeds has your
                contact details in relation to a pharmacovigilance report or compliance matter — you don't have a
                SafeMeds account.
              </Text>
            )}
            <Text style={{ fontSize: '12px', color: MUTED, margin: '0 0 8px' }}>
              SafeMeds will never ask you for your password, a verification code, or your MFA code by email or
              phone. If something in this message feels off, don't act on it — contact your company administrator.
            </Text>
            <Hr style={{ borderColor: BORDER, margin: '16px 0' }} />
            <Text style={{ fontSize: '11px', color: MUTED, margin: 0, textAlign: 'center' }}>
              SafeMeds Compliance Platform · Audit-grade pharmacovigilance, quality &amp; regulatory infrastructure
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
