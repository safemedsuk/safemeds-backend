import { SupportedLocale } from './locale'

/**
 * Message catalog for every in-app `Notification` (and the matching
 * notification email, since `NotificationsService.create()` reuses the
 * same resolved title/body for both) this app creates at one of its
 * ~19 real call sites — the notification-content half of todo-i18n.md
 * decision 6. Same discipline as `email-messages.ts`: `en` is the
 * source of truth, `NotificationMessageKey` derived from it, `fr`
 * typed as `Record<NotificationMessageKey, string>` so a missing key
 * is a compile error. Resolution (which key a given call actually
 * needs — e.g. the overdue vs. approaching branch of a reminder) is
 * decided by the caller and by `notification-content.ts`'s own
 * `resolveNotificationContent()`, never baked into this file as
 * conditional logic.
 */
export const en = {
  'regQueryAssigned.title': 'A regulator query was assigned to you',
  'regQueryAssigned.bodyWithDeadline':
    "You've been made the owner of a regulator query. The regulator's stated deadline is {dueDate}.",
  'regQueryAssigned.bodyNoDeadline':
    "You've been made the owner of a regulator query. No response due date has been recorded yet.",

  'regDeadlineEscalation.titleApproaching':
    '{recordTypeLabel} approaching ({threshold}): {recordType} due {dueDate}',
  'regDeadlineEscalation.titleBreached':
    '{recordTypeLabel} deadline BREACHED: {recordType} due {dueDate}',
  'escalationBody.recordSuffix': '{title}. Record: {recordType}/{recordId}.',

  'postMarketObligationOverdue.title':
    'Post-market obligation overdue: {obligationType} (registration {registrationNumber}), due {dueDate}',
  'postMarketObligationOverdue.body': '{title}. Obligation {obligationId}.',

  'retentionDue.title': '{year} retention due — {brandName} ({registrationNumber})',
  'retentionDue.body':
    '{title}. Log the invoice and proof of payment before 31 December {year} to keep this registration in good standing.',
  'retentionDue.emailBody':
    "This is a weekly reminder that {brandName}'s {year} retention (registration {registrationNumber}) has not yet been logged. Please log the invoice and proof of payment in SafeMeds before 31 December {year}.",

  'regQueryReminder.titleOverdue': 'Overdue regulator query — due {dueLabel}',
  'regQueryReminder.titleDue': 'Regulator query due {dueLabel}',
  'regQueryReminder.bodyOverdue':
    'A regulator query ("{queryPreview}...") is now overdue — the response deadline of {dueLabel} has passed with no response on file.',
  'regQueryReminder.bodyDue':
    'A regulator query ("{queryPreview}...") is due {dueLabel}. Respond before the deadline.',
  'regQueryReminder.emailSuffix': 'Please respond and log it in SafeMeds as soon as possible.',

  'renewalDue.title': 'Renewal due — {brandName} ({registrationNumber}) expires {expiresOn}',
  'renewalDue.body':
    '{title}. Start the renewal from Master Data → Registrations before it lapses.',
  'renewalDue.emailBody':
    "This is a weekly reminder that {brandName}'s registration ({registrationNumber}) expires on {expiresOn}. Please start the renewal in SafeMeds before it lapses.",

  'licensingFacilityExpired.title': 'Facility licence EXPIRED: {name} (licence {licenceNumber})',
  'licensingFacilityApproaching.title':
    'Facility licence renewal approaching: {name}, due {dueDate}',
  'licensingPersonnelExpired.title': 'Personnel licence EXPIRED: {licenceType} ({licenceNumber})',
  'licensingPersonnelApproaching.title':
    'Personnel licence renewal approaching: {licenceType} ({licenceNumber}), due {dueDate}',
  'licensingPermitExpired.title': 'Import/export permit EXPIRED: {permitType} ({permitNumber})',
  'licensingPermitApproaching.title':
    'Import/export permit renewal approaching: {permitType} ({permitNumber}), due {dueDate}',
  'licensingEscalation.unnumbered': 'unnumbered',

  'feeOverdue.title': 'Regulatory fee overdue: {feeType} ({currency} {amount}), due {dueDate}',
  'feeOverdue.body': '{title}. Invoice {invoiceId}.',

  'workflowDeadlineApproaching.title':
    'Reporting deadline approaching ({threshold}): {recordType} due {dueDate}',
  'workflowDeadlineBreached.title': 'Reporting deadline BREACHED: {recordType} due {dueDate}',

  'supplierReviewOverdue.title': 'Supplier review overdue: {supplierName}',
  'supplierReviewDue.title': 'Supplier review due: {supplierName}',
  'supplierReviewOverdue.body':
    'The two-year performance review for {supplierName} was due on {dueDate} and has not been recorded.',
  'supplierReviewDue.body':
    'The two-year performance review for {supplierName} is due on {dueDate}. Upload the review checklist and record the review.',

  'deviationInvestigationOverdue.title': 'Investigation overdue: {deviationNumber}',
  'deviationInvestigationDue.title': 'Investigation due soon: {deviationNumber}',
  'deviationInvestigationOverdue.body':
    'The investigation for "{deviationTitle}" was due on {dueDate} and has not been completed.',
  'deviationInvestigationDue.body': 'The investigation for "{deviationTitle}" is due on {dueDate}.',

  'criticalDeviationRaised.title': 'Critical deviation raised: {deviationNumber}',
  'criticalDeviationRaised.body':
    '"{deviationTitle}" was classified Critical and needs immediate attention.',

  'managementReviewDue.title': 'Quarterly management review is due',
  'managementReviewDue.body':
    'Schedule the next management review from Quality → Metrics & Trends.',

  'qualityTrendDetected.title': 'Quality trend detected: {category}',
  'qualityTrendDetected.body':
    '{capaCount} CAPAs sharing root cause "{category}" have been opened within the last {windowDays} days.',

  'draftReviewDue.title': 'Draft review due: case {referenceNumber}',
  'draftReviewDue.bodyClaimed':
    'You claimed this draft — it still needs to be confirmed or rejected.',
  'draftReviewDue.bodyUnclaimed':
    'This draft has been waiting for review — confirm it as a real case, or reject it with a reason.',

  'followUpContactEmailed.title':
    'Follow-up {attemptNumber} — case {referenceNumber} — due {dueDate}',
  'followUpContactEmailed.body':
    'Automated follow-up email {attemptNumber} sent to the reporter for case {referenceNumber}. Reporter contact: {reporterContact}. Due to respond by {dueDate}.',
  'followUpContactManual.body':
    'Follow-up {attemptNumber} for case {referenceNumber} needs manual contact — {reasonLine}. Reporter contact: {reporterContact}. Please contact by {dueDate} and log the outcome.',
  'followUpContactManual.noConsent': 'contact consent not on file',
  'followUpContactManual.noEmail': 'no reporter email on file',
  'followUpContactEmail.subject': 'Follow-up on your safety report {referenceNumber}',
  'followUpContactEmail.body':
    "We're following up on the report you submitted (reference {referenceNumber}). If you have any updates on the outcome, please reply to this email or contact us.",

  'followUpClosed.titleResolved': 'Follow-up closed: resolved',
  'followUpClosed.titleFailed': 'Follow-up closed: failed to reach reporter',
  'followUpClosed.reasonCeiling': 'Reached the 28-day hard ceiling with no resolution',
  'followUpClosed.reasonResponded': 'Reporter responded on attempt {attemptNumber}',
  'followUpClosed.reasonNoResponse': 'No response after 2 attempts',

  'recallMessage.subjectDrill': '[DRILL] Product recall notice',
  'recallMessage.subjectReal': 'Product recall notice — action required',

  'contactTest.subject': 'SafeMeds reachability test — please confirm receipt',
  'contactTest.bodyWithPurpose':
    "This is a routine test of this mailbox's reachability ({purpose}). Please reply to confirm you received this message. No action is needed beyond a reply — this is not a safety report.",
  'contactTest.bodyNoPurpose':
    "This is a routine test of this mailbox's reachability. Please reply to confirm you received this message. No action is needed beyond a reply — this is not a safety report.",
} as const

export type NotificationMessageKey = keyof typeof en

export const fr: Record<NotificationMessageKey, string> = {
  'regQueryAssigned.title': 'Une question du régulateur vous a été assignée',
  'regQueryAssigned.bodyWithDeadline':
    'Vous avez été désigné(e) responsable d’une question du régulateur. L’échéance déclarée par le régulateur est le {dueDate}.',
  'regQueryAssigned.bodyNoDeadline':
    'Vous avez été désigné(e) responsable d’une question du régulateur. Aucune date d’échéance de réponse n’a encore été enregistrée.',

  'regDeadlineEscalation.titleApproaching':
    '{recordTypeLabel} approche ({threshold}) : {recordType} dû le {dueDate}',
  'regDeadlineEscalation.titleBreached':
    'Échéance {recordTypeLabel} DÉPASSÉE : {recordType} dû le {dueDate}',
  'escalationBody.recordSuffix': '{title}. Enregistrement : {recordType}/{recordId}.',

  'postMarketObligationOverdue.title':
    'Obligation post-commercialisation en retard : {obligationType} (enregistrement {registrationNumber}), échéance {dueDate}',
  'postMarketObligationOverdue.body': '{title}. Obligation {obligationId}.',

  'retentionDue.title': 'Conservation {year} due — {brandName} ({registrationNumber})',
  'retentionDue.body':
    '{title}. Enregistrez la facture et la preuve de paiement avant le 31 décembre {year} pour maintenir cet enregistrement en règle.',
  'retentionDue.emailBody':
    'Ceci est un rappel hebdomadaire que la conservation {year} de {brandName} (enregistrement {registrationNumber}) n’a pas encore été enregistrée. Veuillez enregistrer la facture et la preuve de paiement dans SafeMeds avant le 31 décembre {year}.',

  'regQueryReminder.titleOverdue': 'Question du régulateur en retard — échéance {dueLabel}',
  'regQueryReminder.titleDue': 'Question du régulateur due {dueLabel}',
  'regQueryReminder.bodyOverdue':
    'Une question du régulateur (« {queryPreview}... ») est maintenant en retard — l’échéance de réponse du {dueLabel} est dépassée sans réponse enregistrée.',
  'regQueryReminder.bodyDue':
    'Une question du régulateur (« {queryPreview}... ») est due {dueLabel}. Répondez avant l’échéance.',
  'regQueryReminder.emailSuffix':
    'Veuillez répondre et l’enregistrer dans SafeMeds dès que possible.',

  'renewalDue.title':
    'Renouvellement dû — {brandName} ({registrationNumber}) expire le {expiresOn}',
  'renewalDue.body':
    '{title}. Démarrez le renouvellement depuis Données de référence → Enregistrements avant son expiration.',
  'renewalDue.emailBody':
    'Ceci est un rappel hebdomadaire que l’enregistrement de {brandName} ({registrationNumber}) expire le {expiresOn}. Veuillez démarrer le renouvellement dans SafeMeds avant son expiration.',

  'licensingFacilityExpired.title': 'Licence de site EXPIRÉE : {name} (licence {licenceNumber})',
  'licensingFacilityApproaching.title':
    'Renouvellement de licence de site approchant : {name}, échéance {dueDate}',
  'licensingPersonnelExpired.title':
    'Licence personnelle EXPIRÉE : {licenceType} ({licenceNumber})',
  'licensingPersonnelApproaching.title':
    'Renouvellement de licence personnelle approchant : {licenceType} ({licenceNumber}), échéance {dueDate}',
  'licensingPermitExpired.title': 'Permis d’import/export EXPIRÉ : {permitType} ({permitNumber})',
  'licensingPermitApproaching.title':
    'Renouvellement de permis d’import/export approchant : {permitType} ({permitNumber}), échéance {dueDate}',
  'licensingEscalation.unnumbered': 'non numéroté',

  'feeOverdue.title':
    'Frais réglementaires en retard : {feeType} ({currency} {amount}), échéance {dueDate}',
  'feeOverdue.body': '{title}. Facture {invoiceId}.',

  'workflowDeadlineApproaching.title':
    'Échéance de déclaration approchant ({threshold}) : {recordType} dû le {dueDate}',
  'workflowDeadlineBreached.title':
    'Échéance de déclaration DÉPASSÉE : {recordType} dû le {dueDate}',

  'supplierReviewOverdue.title': 'Révision de fournisseur en retard : {supplierName}',
  'supplierReviewDue.title': 'Révision de fournisseur due : {supplierName}',
  'supplierReviewOverdue.body':
    'La révision bisannuelle de performance de {supplierName} était due le {dueDate} et n’a pas été enregistrée.',
  'supplierReviewDue.body':
    'La révision bisannuelle de performance de {supplierName} est due le {dueDate}. Téléchargez la liste de contrôle de révision et enregistrez-la.',

  'deviationInvestigationOverdue.title': 'Investigation en retard : {deviationNumber}',
  'deviationInvestigationDue.title': 'Investigation bientôt due : {deviationNumber}',
  'deviationInvestigationOverdue.body':
    'L’investigation pour « {deviationTitle} » était due le {dueDate} et n’a pas été terminée.',
  'deviationInvestigationDue.body':
    'L’investigation pour « {deviationTitle} » est due le {dueDate}.',

  'criticalDeviationRaised.title': 'Déviation critique soulevée : {deviationNumber}',
  'criticalDeviationRaised.body':
    '« {deviationTitle} » a été classée Critique et nécessite une attention immédiate.',

  'managementReviewDue.title': 'La revue de direction trimestrielle est due',
  'managementReviewDue.body':
    'Planifiez la prochaine revue de direction depuis Qualité → Métriques et tendances.',

  'qualityTrendDetected.title': 'Tendance qualité détectée : {category}',
  'qualityTrendDetected.body':
    '{capaCount} CAPA partageant la cause racine « {category} » ont été ouvertes au cours des {windowDays} derniers jours.',

  'draftReviewDue.title': 'Révision de brouillon due : cas {referenceNumber}',
  'draftReviewDue.bodyClaimed':
    'Vous avez réclamé ce brouillon — il doit encore être confirmé ou rejeté.',
  'draftReviewDue.bodyUnclaimed':
    'Ce brouillon attend une révision — confirmez-le comme un cas réel, ou rejetez-le avec une raison.',

  'followUpContactEmailed.title':
    'Suivi {attemptNumber} — cas {referenceNumber} — échéance {dueDate}',
  'followUpContactEmailed.body':
    'E-mail de suivi automatique {attemptNumber} envoyé au déclarant pour le cas {referenceNumber}. Contact du déclarant : {reporterContact}. Réponse attendue avant le {dueDate}.',
  'followUpContactManual.body':
    'Le suivi {attemptNumber} pour le cas {referenceNumber} nécessite un contact manuel — {reasonLine}. Contact du déclarant : {reporterContact}. Veuillez contacter avant le {dueDate} et enregistrer le résultat.',
  'followUpContactManual.noConsent': 'consentement de contact non enregistré',
  'followUpContactManual.noEmail': 'aucun e-mail du déclarant enregistré',
  'followUpContactEmail.subject': 'Suivi de votre rapport de sécurité {referenceNumber}',
  'followUpContactEmail.body':
    'Nous faisons suite au rapport que vous avez soumis (référence {referenceNumber}). Si vous avez des informations supplémentaires sur le résultat, veuillez répondre à cet e-mail ou nous contacter.',

  'followUpClosed.titleResolved': 'Suivi clos : résolu',
  'followUpClosed.titleFailed': 'Suivi clos : échec du contact avec le déclarant',
  'followUpClosed.reasonCeiling': 'Le plafond strict de 28 jours a été atteint sans résolution',
  'followUpClosed.reasonResponded': 'Le déclarant a répondu à la tentative {attemptNumber}',
  'followUpClosed.reasonNoResponse': 'Aucune réponse après 2 tentatives',

  'recallMessage.subjectDrill': '[EXERCICE] Avis de rappel de produit',
  'recallMessage.subjectReal': 'Avis de rappel de produit — action requise',

  'contactTest.subject': 'Test de joignabilité SafeMeds — veuillez confirmer la réception',
  'contactTest.bodyWithPurpose':
    'Ceci est un test de routine de la joignabilité de cette boîte mail ({purpose}). Veuillez répondre pour confirmer la réception de ce message. Aucune action n’est requise au-delà d’une réponse — ceci n’est pas un rapport de sécurité.',
  'contactTest.bodyNoPurpose':
    'Ceci est un test de routine de la joignabilité de cette boîte mail. Veuillez répondre pour confirmer la réception de ce message. Aucune action n’est requise au-delà d’une réponse — ceci n’est pas un rapport de sécurité.',
}

/** Plain `{paramName}` substring replace — same discipline as `email-messages.ts`'s own `t()`. */
export function t(
  locale: SupportedLocale,
  key: NotificationMessageKey,
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
