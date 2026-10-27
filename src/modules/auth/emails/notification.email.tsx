import { Button, Text } from '@react-email/components';
import * as React from 'react';

import { t } from '../../../common/i18n/email-messages';
import { DEFAULT_LOCALE, SupportedLocale } from '../../../common/i18n/locale';
import { EmailLayout } from './layout';

interface NotificationEmailProps {
  heading: string;
  bodyText: string;
  /** Rendered as a bulleted list under `bodyText` — e.g. the fields still missing from a drafted case-intake email. */
  listItems?: string[];
  /** Rendered after `listItems` (or after `bodyText` if there's no list) — a closing note distinct from the main message. */
  trailingText?: string;
  actionUrl?: string;
  actionLabel?: string;
  eyebrow?: string;
  recipientEmail?: string;
  recipientContext?: 'account' | 'external';
  /** Defaults to English — only ever affects this wrapper's own default `actionLabel`/`eyebrow`/layout chrome; `heading`/`bodyText`/`trailingText` are supplied by the caller already resolved to the right locale (see `MailService`'s own doc comments on which callers do this today vs. which still bake in English). */
  locale?: SupportedLocale;
}

/**
 * Special Corner SC-7 — the one shared template every non-auth
 * notification (task/deadline reminders, case-intake follow-up
 * requests, contact-testing pings, case-follow-up reporter outreach,
 * safety-alert/DHCP-letter recipient notices) now renders through,
 * closing the gap where these previously bypassed the branded
 * `EmailLayout`/`LogoMark` system entirely in favor of a raw,
 * hand-built HTML string with no logo and inconsistent styling — the
 * exact complaint that first surfaced against the contact-testing
 * email specifically. `MailService.sendNotification()`/
 * `sendCaseIntakeFollowUp()` are the only two call sites; every
 * `NotificationsService.sendExternalEmail()` caller routes through
 * `sendNotification()` already, so fixing it here fixes all of them
 * at once rather than needing a bespoke template per category — the
 * same "frequent, high-volume, system-generated" reasoning that
 * originally justified skipping a dedicated template per category
 * still holds, it just now still deserves real branding.
 */
export function NotificationEmail({
  heading,
  bodyText,
  listItems,
  trailingText,
  actionUrl,
  actionLabel,
  eyebrow,
  recipientEmail,
  recipientContext = 'account',
  locale = DEFAULT_LOCALE,
}: NotificationEmailProps): React.ReactElement {
  const resolvedActionLabel = actionLabel ?? t(locale, 'notificationGeneric.actionLabelDefault');
  const resolvedEyebrow = eyebrow ?? t(locale, 'notificationGeneric.eyebrowDefault');
  return (
    <EmailLayout
      previewText={heading}
      heading={heading}
      eyebrow={resolvedEyebrow}
      recipientEmail={recipientEmail}
      recipientContext={recipientContext}
      locale={locale}
    >
      <Text style={{ fontSize: '14px', color: '#3f3f46', lineHeight: '22px', margin: '0 0 16px', whiteSpace: 'pre-line' }}>{bodyText}</Text>
      {listItems && listItems.length > 0 && (
        <ul style={{ fontSize: '14px', color: '#3f3f46', lineHeight: '22px', margin: '0 0 20px', paddingLeft: '20px' }}>
          {listItems.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
      {trailingText && (
        <Text style={{ fontSize: '13px', color: '#71717a', margin: '0 0 20px', whiteSpace: 'pre-line' }}>{trailingText}</Text>
      )}
      {actionUrl && (
        <Button
          href={actionUrl}
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
          {resolvedActionLabel}
        </Button>
      )}
    </EmailLayout>
  );
}
