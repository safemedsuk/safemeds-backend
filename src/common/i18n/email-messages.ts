import { SupportedLocale } from './locale'

/**
 * Message catalog for every outbound email this app sends — the
 * backend half of todo-i18n.md's Stage 5. Mirrors the frontend's own
 * `lib/i18n/messages/en.ts`/`fr.ts` discipline exactly: `en` is the
 * source of truth, `EmailMessageKey` is derived from its own keys, and
 * `fr` is typed as `Record<EmailMessageKey, string>` so a missing or
 * extra French key is a compile error, never a silent runtime gap.
 * Interpolation is the same plain `{paramName}` substring replace the
 * frontend uses, not full ICU — fine for the short, mostly-static
 * strings an email template needs.
 */
export const en = {
  'layout.eyebrowDefault': 'Account security',
  'layout.trustFooterAccountPrefix': 'This email was sent to ',
  'layout.trustFooterAccountSuffix':
    "because it's associated with a SafeMeds account or registration.",
  'layout.trustFooterExternalPrefix': 'This email was sent to ',
  'layout.trustFooterExternalSuffix':
    "because a company using SafeMeds has your contact details in relation to a pharmacovigilance report or compliance matter — you don't have a SafeMeds account.",
  'layout.securityLine':
    "SafeMeds will never ask you for your password, a verification code, or your MFA code by email or phone. If something in this message feels off, don't act on it — contact your company administrator.",
  'layout.tagline':
    'SafeMeds Compliance Platform · Audit-grade pharmacovigilance, quality & regulatory infrastructure',

  'verificationCode.subject': 'Verify your SafeMeds email address',
  'verificationCode.previewText': 'Your SafeMeds verification code is {code}',
  'verificationCode.heading': 'Verify your email address',
  'verificationCode.eyebrow': 'Verification code',
  'verificationCode.body':
    'Enter this code to verify your email and continue setting up your SafeMeds account.',
  'verificationCode.footer':
    "This code expires in {minutes} minutes and can only be used once. If you didn't request this, you can safely ignore this email — no account will be created without it.",

  'approval.subject': 'Your SafeMeds registration has been approved',
  'approval.previewText': 'Your SafeMeds registration has been approved',
  'approval.heading': 'Registration approved',
  'approval.eyebrow': 'Account approved',
  'approval.bodyPrefix': 'Good news — ',
  'approval.bodySuffix':
    'has been reviewed and approved on SafeMeds. You can now sign in with the administrator account you created during registration.',
  'approval.button': 'Sign in to SafeMeds',
  'approval.footer':
    'As a first step, we recommend enabling multi-factor authentication from Settings → Security to add an extra layer of protection to your account.',

  'rejection.subject': 'Your SafeMeds registration was not approved',
  'rejection.previewText': 'Your SafeMeds registration was not approved',
  'rejection.heading': 'Registration not approved',
  'rejection.eyebrow': 'Registration decision',
  'rejection.bodyLeadPrefix': 'We were unable to approve the registration for ',
  'rejection.bodyLeadSuffix': '.',
  'rejection.bodyFollowUp':
    "You're welcome to submit a new registration once the issue above is corrected — reference numbers aren't reused, so this starts a fresh review.",
  'rejection.button': 'Submit a new registration',

  'passwordReset.subject': 'Reset your SafeMeds password',
  'passwordReset.previewText': 'Reset your SafeMeds password',
  'passwordReset.heading': 'Reset your password',
  'passwordReset.eyebrow': 'Password reset requested',
  'passwordReset.body':
    'We received a request to reset the password for your SafeMeds account. Click below to choose a new one.',
  'passwordReset.button': 'Reset my password',
  'passwordReset.footer':
    "This link expires in {minutes} minutes and can only be used once. If you didn't request a password reset, no action is needed — your password will not be changed and you can safely ignore this email.",

  'passwordChanged.subject': 'Your SafeMeds password was changed',
  'passwordChanged.previewText': 'Your SafeMeds password was changed',
  'passwordChanged.heading': 'Your password was changed',
  'passwordChanged.eyebrow': 'Security alert',
  'passwordChanged.bodyPrefix': 'The password for your SafeMeds account was changed on ',
  'passwordChanged.bodySuffix':
    'All other sessions and devices have been signed out as a precaution.',
  'passwordChanged.warning':
    "If this wasn't you, contact your company administrator immediately — your account may be compromised.",

  'invitation.subject': "You've been invited to join {companyName} on SafeMeds",
  'invitation.previewText': '{inviterName} invited you to join {companyName} on SafeMeds',
  'invitation.heading': "You've been invited to SafeMeds",
  'invitation.eyebrow': 'Team invitation',
  'invitation.bodySingularMid': 'has invited you to join',
  'invitation.bodySingularSuffix': 'on SafeMeds with the following role:',
  'invitation.bodyPluralMid': 'has invited you to join',
  'invitation.bodyPluralSuffix': 'on SafeMeds with the following roles:',
  'invitation.button': 'Accept invitation',
  'invitation.footer':
    "This invitation expires in {days} days. If you weren't expecting this, you can safely ignore this email.",

  'notificationGeneric.eyebrowDefault': 'Notification',
  'notificationGeneric.actionLabelDefault': 'Open in SafeMeds',

  'caseIntakeFollowUp.subject': 'Additional information needed — {companyName} drug safety report',
  'caseIntakeFollowUp.eyebrow': 'Drug safety report',
  'caseIntakeFollowUp.heading': 'A few more details needed',
  'caseIntakeFollowUp.body':
    'Thank you for your report to {companyName}\'s drug safety team (re: "{originalSubject}").\n\nTo process your report, we still need the following information. Please reply to this email with these details:',
  'caseIntakeFollowUp.trailer':
    'If you believe you already included this information, please resend it as clearly labelled lines (e.g. "Product: ...", "Reaction: ...") so it can be captured accurately.',

  'caseReceivedConfirmation.subject': 'Report received — {companyName}',
  'caseReceivedConfirmation.eyebrow': 'Drug safety report',
  'caseReceivedConfirmation.heading': 'Thank you — your report has been received',
  'caseReceivedConfirmation.body':
    'Thank you for reporting a safety concern to {companyName}. Your report has been recorded and will be reviewed by their safety team. No further action is needed from you right now.\n\nYour reference number is:',
  'caseReceivedConfirmation.trailer':
    'If you have more information to add, please reply to this email or use the same reporting channel again, quoting this reference number.',
} as const

export type EmailMessageKey = keyof typeof en

export const fr: Record<EmailMessageKey, string> = {
  'layout.eyebrowDefault': 'Sécurité du compte',
  'layout.trustFooterAccountPrefix': 'Cet e-mail a été envoyé à ',
  'layout.trustFooterAccountSuffix':
    'car il est associé à un compte ou à un enregistrement SafeMeds.',
  'layout.trustFooterExternalPrefix': 'Cet e-mail a été envoyé à ',
  'layout.trustFooterExternalSuffix':
    "car une entreprise utilisant SafeMeds dispose de vos coordonnées dans le cadre d'un rapport de pharmacovigilance ou d'une question de conformité — vous n'avez pas de compte SafeMeds.",
  'layout.securityLine':
    "SafeMeds ne vous demandera jamais votre mot de passe, un code de vérification ou votre code MFA par e-mail ou téléphone. Si quelque chose dans ce message semble suspect, n'agissez pas — contactez l'administrateur de votre entreprise.",
  'layout.tagline':
    'Plateforme de conformité SafeMeds · Infrastructure de pharmacovigilance, qualité et réglementaire de niveau audit',

  'verificationCode.subject': 'Vérifiez votre adresse e-mail SafeMeds',
  'verificationCode.previewText': 'Votre code de vérification SafeMeds est {code}',
  'verificationCode.heading': 'Vérifiez votre adresse e-mail',
  'verificationCode.eyebrow': 'Code de vérification',
  'verificationCode.body':
    'Saisissez ce code pour vérifier votre e-mail et poursuivre la configuration de votre compte SafeMeds.',
  'verificationCode.footer':
    "Ce code expire dans {minutes} minutes et ne peut être utilisé qu'une seule fois. Si vous n'avez pas demandé cela, vous pouvez ignorer cet e-mail en toute sécurité — aucun compte ne sera créé sans lui.",

  'approval.subject': 'Votre enregistrement SafeMeds a été approuvé',
  'approval.previewText': 'Votre enregistrement SafeMeds a été approuvé',
  'approval.heading': 'Enregistrement approuvé',
  'approval.eyebrow': 'Compte approuvé',
  'approval.bodyPrefix': 'Bonne nouvelle — ',
  'approval.bodySuffix':
    'a été examiné et approuvé sur SafeMeds. Vous pouvez désormais vous connecter avec le compte administrateur créé lors de l’enregistrement.',
  'approval.button': 'Se connecter à SafeMeds',
  'approval.footer':
    "Comme première étape, nous vous recommandons d'activer l'authentification multifacteur depuis Paramètres → Sécurité pour ajouter une couche de protection supplémentaire à votre compte.",

  'rejection.subject': "Votre enregistrement SafeMeds n'a pas été approuvé",
  'rejection.previewText': "Votre enregistrement SafeMeds n'a pas été approuvé",
  'rejection.heading': 'Enregistrement non approuvé',
  'rejection.eyebrow': "Décision d'enregistrement",
  'rejection.bodyLeadPrefix': "Nous n'avons pas pu approuver l'enregistrement de ",
  'rejection.bodyLeadSuffix': '.',
  'rejection.bodyFollowUp':
    'Vous pouvez soumettre un nouvel enregistrement une fois le problème ci-dessus corrigé — les numéros de référence ne sont pas réutilisés, ceci démarre donc un nouvel examen.',
  'rejection.button': 'Soumettre un nouvel enregistrement',

  'passwordReset.subject': 'Réinitialisez votre mot de passe SafeMeds',
  'passwordReset.previewText': 'Réinitialisez votre mot de passe SafeMeds',
  'passwordReset.heading': 'Réinitialisez votre mot de passe',
  'passwordReset.eyebrow': 'Réinitialisation de mot de passe demandée',
  'passwordReset.body':
    'Nous avons reçu une demande de réinitialisation du mot de passe de votre compte SafeMeds. Cliquez ci-dessous pour en choisir un nouveau.',
  'passwordReset.button': 'Réinitialiser mon mot de passe',
  'passwordReset.footer':
    "Ce lien expire dans {minutes} minutes et ne peut être utilisé qu'une seule fois. Si vous n'avez pas demandé de réinitialisation de mot de passe, aucune action n'est nécessaire — votre mot de passe ne sera pas modifié et vous pouvez ignorer cet e-mail en toute sécurité.",

  'passwordChanged.subject': 'Votre mot de passe SafeMeds a été modifié',
  'passwordChanged.previewText': 'Votre mot de passe SafeMeds a été modifié',
  'passwordChanged.heading': 'Votre mot de passe a été modifié',
  'passwordChanged.eyebrow': 'Alerte de sécurité',
  'passwordChanged.bodyPrefix': 'Le mot de passe de votre compte SafeMeds a été modifié le ',
  'passwordChanged.bodySuffix':
    'Toutes les autres sessions et appareils ont été déconnectés par précaution.',
  'passwordChanged.warning':
    "Si ce n'était pas vous, contactez immédiatement l'administrateur de votre entreprise — votre compte pourrait être compromis.",

  'invitation.subject': 'Vous avez été invité(e) à rejoindre {companyName} sur SafeMeds',
  'invitation.previewText': '{inviterName} vous a invité(e) à rejoindre {companyName} sur SafeMeds',
  'invitation.heading': 'Vous avez été invité(e) sur SafeMeds',
  'invitation.eyebrow': "Invitation d'équipe",
  'invitation.bodySingularMid': 'vous a invité(e) à rejoindre',
  'invitation.bodySingularSuffix': 'sur SafeMeds avec le rôle suivant :',
  'invitation.bodyPluralMid': 'vous a invité(e) à rejoindre',
  'invitation.bodyPluralSuffix': 'sur SafeMeds avec les rôles suivants :',
  'invitation.button': "Accepter l'invitation",
  'invitation.footer':
    "Cette invitation expire dans {days} jours. Si vous ne l'attendiez pas, vous pouvez ignorer cet e-mail en toute sécurité.",

  'notificationGeneric.eyebrowDefault': 'Notification',
  'notificationGeneric.actionLabelDefault': 'Ouvrir dans SafeMeds',

  'caseIntakeFollowUp.subject':
    'Informations complémentaires nécessaires — rapport de pharmacovigilance {companyName}',
  'caseIntakeFollowUp.eyebrow': 'Rapport de pharmacovigilance',
  'caseIntakeFollowUp.heading': 'Quelques détails supplémentaires sont nécessaires',
  'caseIntakeFollowUp.body':
    'Merci pour votre rapport à l’équipe de pharmacovigilance de {companyName} (réf. : « {originalSubject} »).\n\nPour traiter votre rapport, nous avons encore besoin des informations suivantes. Veuillez répondre à cet e-mail avec ces détails :',
  'caseIntakeFollowUp.trailer':
    'Si vous pensez avoir déjà inclus ces informations, veuillez les renvoyer sous forme de lignes clairement identifiées (ex. « Produit : ... », « Réaction : ... ») afin qu’elles puissent être correctement saisies.',

  'caseReceivedConfirmation.subject': 'Rapport reçu — {companyName}',
  'caseReceivedConfirmation.eyebrow': 'Rapport de pharmacovigilance',
  'caseReceivedConfirmation.heading': 'Merci — votre rapport a été reçu',
  'caseReceivedConfirmation.body':
    'Merci d’avoir signalé un problème de sécurité à {companyName}. Votre rapport a été enregistré et sera examiné par leur équipe de sécurité. Aucune autre action n’est requise de votre part pour le moment.\n\nVotre numéro de référence est :',
  'caseReceivedConfirmation.trailer':
    'Si vous avez des informations supplémentaires à ajouter, veuillez répondre à cet e-mail ou utiliser à nouveau le même canal de signalement, en citant ce numéro de référence.',
}

/** Plain `{paramName}` substring replace — matches the frontend's own `useTranslation()` interpolation exactly, deliberately not full ICU (see todo-i18n.md's architecture note). */
export function t(
  locale: SupportedLocale,
  key: EmailMessageKey,
  params?: Record<string, string>,
): string {
  const catalog = locale === 'fr' ? fr : en
  let result: string = catalog[key]
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      result = result.replaceAll(`{${name}}`, value)
    }
  }
  return result
}
