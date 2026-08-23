import { Injectable } from '@nestjs/common'
import { CaseChannel, DrugCharacterization, PatientSex, ReactionOutcome } from '@prisma/client'

import { SubmissionCaseData } from './regulatory-submission.types'

function escapeXml(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

/** ICH E2B date format 102 — YYYYMMDD. */
export function formatE2bDate(date: Date): string {
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`
}

/** ICH E2B date format 204 — YYYYMMDDHHMMSS, used for message-level timestamps. */
export function formatE2bDateTime(date: Date): string {
  return `${formatE2bDate(date)}${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}`
}

/**
 * ICH E2B `reporttype` — 1=Spontaneous, 2=Report from study, 3=Other,
 * 4=Not available to sender. Our own `CaseChannel` has no direct study/
 * literature-vs-spontaneous distinction beyond these two values — every
 * other channel (form, hotline, email, WhatsApp, public URL, HCP-direct,
 * post) is a real-world spontaneous report by ICH's own definition.
 */
export function mapReportType(channel: CaseChannel): '1' | '2' | '3' {
  if (channel === 'clinical_study') return '2'
  if (channel === 'literature') return '3'
  return '1'
}

/** ICH E2B boolean-flag convention throughout `safetyreport`/`reaction` — 1=Yes, 2=No. */
export function yesNo(value: boolean): '1' | '2' {
  return value ? '1' : '2'
}

/** ICH E2B `patientsex` — 1=Male, 2=Female; omitted (undefined) when unknown, since E2B allows the element to be absent entirely rather than forcing a guess. */
export function mapPatientSex(sex: PatientSex): '1' | '2' | undefined {
  if (sex === 'male') return '1'
  if (sex === 'female') return '2'
  return undefined
}

/** ICH E2B `reactionoutcome` — 1=Recovered/resolved, 2=Recovering/resolving, 3=Not recovered/not resolved, 4=Recovered with sequelae, 5=Fatal, 6=Unknown. */
export function mapReactionOutcome(outcome: ReactionOutcome): '1' | '2' | '3' | '4' | '5' | '6' {
  const table: Record<ReactionOutcome, '1' | '2' | '3' | '4' | '5' | '6'> = {
    recovered: '1',
    recovering: '2',
    not_recovered: '3',
    recovered_with_sequelae: '4',
    fatal: '5',
    unknown: '6',
  }
  return table[outcome]
}

/** ICH E2B `drugcharacterization` — 1=Suspect, 2=Concomitant, 3=Interacting. Already a direct match with our own enum (see `SuspectProduct.drugCharacterization`'s own schema doc comment). */
export function mapDrugCharacterization(value: DrugCharacterization): '1' | '2' | '3' {
  const table: Record<DrugCharacterization, '1' | '2' | '3'> = {
    suspect: '1',
    concomitant: '2',
    interacting: '3',
  }
  return table[value]
}

/**
 * ICH E2B `actiondrug` — 1=Withdrawn, 2=Dose reduced, 3=Dose increased,
 * 4=Dose not changed, 5=Unknown, 6=Not applicable. Our own schema stores
 * `actionTaken` as free text (no coded field exists yet), so this is a
 * best-effort keyword match, not an authoritative mapping — defaults to
 * "5" (unknown) for anything it doesn't recognize, never guesses a
 * specific code from ambiguous text.
 */
export function mapActionTaken(actionTaken: string | null): '1' | '2' | '3' | '4' | '5' | '6' {
  if (!actionTaken) return '5'
  const text = actionTaken.toLowerCase()
  if (text.includes('withdraw') || text.includes('stopped') || text.includes('discontinued'))
    return '1'
  if (text.includes('reduced') || text.includes('decreased')) return '2'
  if (text.includes('increased')) return '3'
  if (text.includes('not changed') || text.includes('continued') || text.includes('unchanged'))
    return '4'
  if (text.includes('not applicable') || text.includes('n/a')) return '6'
  return '5'
}

/**
 * ICH E2B `qualification` (primary-source reporter type) — 1=Physician,
 * 2=Pharmacist, 3=Other health professional, 4=Lawyer, 5=Consumer or
 * other non-health-professional. Our own `Reporter.reporterType` is only
 * a two-way split (consumer/healthcare_professional); for an HCP,
 * `Reporter.qualification`'s free text is keyword-matched to narrow it
 * further, defaulting to "Other health professional" when it doesn't
 * recognize the text — the same honest best-effort shape as
 * `mapActionTaken()` above, not a guess dressed up as certainty.
 */
export function mapReporterQualification(
  reporterType: 'consumer' | 'healthcare_professional',
  qualification: string | null,
): '1' | '2' | '3' | '4' | '5' {
  if (reporterType === 'consumer') return '5'
  const text = (qualification ?? '').toLowerCase()
  if (text.includes('physician') || text.includes('doctor')) return '1'
  if (text.includes('pharmacist')) return '2'
  if (text.includes('lawyer') || text.includes('attorney')) return '4'
  return '3'
}

function splitName(fullName: string): { given: string; family: string } {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) return { given: '', family: parts[0] }
  return { given: parts.slice(0, -1).join(' '), family: parts[parts.length - 1] }
}

/**
 * VigiCloud Stage 12 — builds a real, composed clinical narrative from
 * the case's own captured fields, per the build-spec's own "composed
 * from the case's captured fields, not free-typed by the reviewer at
 * submission time" instruction. Pure and independently testable.
 */
export function buildNarrative(data: SubmissionCaseData): string {
  const sentences: string[] = []

  const reporterKind =
    data.reporter?.reporterType === 'healthcare_professional'
      ? 'a healthcare professional'
      : 'a consumer or other non-healthcare-professional'
  const patientSex =
    data.patient?.sex && data.patient.sex !== 'unknown'
      ? data.patient.sex
      : 'patient of unknown sex'
  const patientAge =
    data.patient?.ageYears !== null && data.patient?.ageYears !== undefined
      ? `, aged ${data.patient.ageYears} years,`
      : ''
  sentences.push(
    `This is a spontaneous report received from ${reporterKind}. A ${patientSex}${patientAge} received the following suspect/concomitant medication(s).`,
  )

  for (const sp of data.suspectProducts) {
    const role =
      sp.drugCharacterization === 'suspect'
        ? 'Suspect'
        : sp.drugCharacterization === 'concomitant'
          ? 'Concomitant'
          : 'Interacting'
    const dates = sp.startDate
      ? ` (start date: ${formatE2bDate(sp.startDate)}${sp.endDate ? `, end date: ${formatE2bDate(sp.endDate)}` : ''})`
      : ''
    sentences.push(
      `${role} medication: ${sp.medicinalProduct}${sp.activeSubstanceName ? ` (${sp.activeSubstanceName})` : ''}${dates}.`,
    )
  }

  for (const ae of data.adverseEvents) {
    const onset = ae.onsetDate ? ` with onset ${formatE2bDate(ae.onsetDate)}` : ''
    sentences.push(
      `Reported adverse event: ${ae.reportedTerm}${onset}, outcome "${ae.outcome.replace(/_/g, ' ')}". Reporter's own words: "${ae.narrative}"`,
    )
  }

  if (data.additionalInformation) {
    sentences.push(`Additional information: ${data.additionalInformation}`)
  }

  return sentences.join('\n\n')
}

/**
 * VigiCloud Stage 12 — the E2B(R3)-shaped XML generator, built directly
 * against the real field structure confirmed by the Kenya PPB sample
 * (`vigicloud docs/Kenya33716702_ENIP131PFIZER_20260731065733.xml`) —
 * every tag name/order below matches that sample, not a guess from the
 * ICH spec alone. `messagereceiveridentifier`/`receiverorganization` are
 * built from this case's own resolved `authority`, so the same generator
 * works for any seeded country/authority, not just Kenya — see the
 * class-level doc comment on why the receiver country code is a
 * deliberate correction of an apparent data-quality slip in the sample
 * (`receivercountrycode` there reads "NG" for a Kenyan case).
 */
@Injectable()
export class E2bXmlBuilderService {
  build(data: SubmissionCaseData): string {
    const referenceDigits = data.case.referenceNumber.replace(/[^0-9]/g, '')
    const safetyReportId = `${data.countryOfReport.isoCode}-${data.company.name.toUpperCase()}-${referenceDigits}`
    const receiverIdentifier = `{HA} ${data.countryOfReport.name} - E2B`

    const anySeriousness = (
      predicate: (ae: SubmissionCaseData['adverseEvents'][number]) => boolean,
    ) => data.adverseEvents.some(predicate)
    const overallSerious =
      anySeriousness((ae) => ae.seriousnessDeath) ||
      anySeriousness((ae) => ae.seriousnessLifeThreatening) ||
      anySeriousness((ae) => ae.seriousnessHospitalization) ||
      anySeriousness((ae) => ae.seriousnessDisabling) ||
      anySeriousness((ae) => ae.seriousnessCongenitalAnomaly) ||
      anySeriousness((ae) => ae.seriousnessOther)

    const senderName = splitName(data.generatedByUserFullName)

    const reactionsXml = data.adverseEvents
      .map((ae) => {
        const lltCode = ae.meddraTerm?.level === 'LLT' ? ae.meddraTerm.code : undefined
        const ptCode =
          ae.meddraTerm && ae.meddraTerm.level !== 'LLT' ? ae.meddraTerm.code : undefined
        const version = ae.meddraTerm?.version.versionLabel
        return `			<reaction>
				<primarysourcereaction>${escapeXml(ae.narrative)}</primarysourcereaction>${
          lltCode
            ? `
				<reactionmeddraversionllt>${escapeXml(version)}</reactionmeddraversionllt>
				<reactionmeddrallt>${escapeXml(lltCode)}</reactionmeddrallt>`
            : ''
        }${
          ptCode
            ? `
				<reactionmeddraversionpt>${escapeXml(version)}</reactionmeddraversionpt>
				<reactionmeddrapt>${escapeXml(ptCode)}</reactionmeddrapt>`
            : ''
        }${
          ae.onsetDate
            ? `
				<reactionstartdateformat>102</reactionstartdateformat>
				<reactionstartdate>${formatE2bDate(ae.onsetDate)}</reactionstartdate>`
            : ''
        }
				<reactionoutcome>${mapReactionOutcome(ae.outcome)}</reactionoutcome>
			</reaction>`
      })
      .join('\n')

    const drugsXml = data.suspectProducts
      .map((sp) => {
        return `			<drug>
				<drugcharacterization>${mapDrugCharacterization(sp.drugCharacterization)}</drugcharacterization>
				<medicinalproduct>${escapeXml(sp.medicinalProduct)}</medicinalproduct>${
          sp.obtainedCountry
            ? `
				<obtaindrugcountry>${sp.obtainedCountry.isoCode}</obtaindrugcountry>`
            : ''
        }
				<drugdosagetext>${escapeXml(sp.doseText ?? 'UNK')}</drugdosagetext>${
          sp.startDate
            ? `
				<drugstartdateformat>102</drugstartdateformat>
				<drugstartdate>${formatE2bDate(sp.startDate)}</drugstartdate>`
            : ''
        }${
          sp.endDate
            ? `
				<drugenddateformat>102</drugenddateformat>
				<drugenddate>${formatE2bDate(sp.endDate)}</drugenddate>`
            : ''
        }
				<actiondrug>${mapActionTaken(sp.actionTaken)}</actiondrug>${
          sp.activeSubstanceName
            ? `
				<activesubstance>
					<activesubstancename>${escapeXml(sp.activeSubstanceName.toUpperCase())}</activesubstancename>
				</activesubstance>`
            : ''
        }
			</drug>`
      })
      .join('\n')

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ichicsr SYSTEM "http://eudravigilance.ema.europa.eu/dtd/icsr21xml.dtd">
<ichicsr lang="en">
	<ichicsrmessageheader>
		<messagetype>ichicsr</messagetype>
		<messageformatversion>2.1</messageformatversion>
		<messageformatrelease>2.0</messageformatrelease>
		<messagenumb>${escapeXml(data.case.referenceNumber)}-${data.submissionNumber}</messagenumb>
		<messagesenderidentifier>${escapeXml(data.company.name.toUpperCase().replace(/\s+/g, ''))}</messagesenderidentifier>
		<messagereceiveridentifier>${escapeXml(receiverIdentifier)}</messagereceiveridentifier>
		<messagedateformat>204</messagedateformat>
		<messagedate>${formatE2bDateTime(data.generatedAt)}</messagedate>
	</ichicsrmessageheader>
	<safetyreport>
		<safetyreportversion>${data.submissionNumber}</safetyreportversion>
		<safetyreportid>${escapeXml(safetyReportId)}</safetyreportid>
		<primarysourcecountry>${data.countryOfOccurrence.isoCode}</primarysourcecountry>
		<occurcountry>${data.countryOfOccurrence.isoCode}</occurcountry>
		<transmissiondateformat>102</transmissiondateformat>
		<transmissiondate>${formatE2bDate(data.generatedAt)}</transmissiondate>
		<reporttype>${mapReportType(data.case.channel)}</reporttype>
		<serious>${yesNo(overallSerious)}</serious>
		<seriousnessdeath>${yesNo(anySeriousness((ae) => ae.seriousnessDeath))}</seriousnessdeath>
		<seriousnesslifethreatening>${yesNo(anySeriousness((ae) => ae.seriousnessLifeThreatening))}</seriousnesslifethreatening>
		<seriousnesshospitalization>${yesNo(anySeriousness((ae) => ae.seriousnessHospitalization))}</seriousnesshospitalization>
		<seriousnessdisabling>${yesNo(anySeriousness((ae) => ae.seriousnessDisabling))}</seriousnessdisabling>
		<seriousnesscongenitalanomali>${yesNo(anySeriousness((ae) => ae.seriousnessCongenitalAnomaly))}</seriousnesscongenitalanomali>
		<seriousnessother>${yesNo(anySeriousness((ae) => ae.seriousnessOther))}</seriousnessother>
		<receivedateformat>102</receivedateformat>
		<receivedate>${formatE2bDate(data.case.receivedDate)}</receivedate>
		<receiptdateformat>102</receiptdateformat>
		<receiptdate>${formatE2bDate(data.case.receivedDate)}</receiptdate>
		<companynumb>${escapeXml(safetyReportId)}</companynumb>
		<primarysource>
			<reporterfamilyname>${escapeXml(data.reporter?.fullName ?? 'UNKNOWN')}</reporterfamilyname>
			<reportercountry>${data.countryOfOccurrence.isoCode}</reportercountry>
			<qualification>${mapReporterQualification(data.reporter?.reporterType ?? 'consumer', data.reporter?.qualification ?? null)}</qualification>
		</primarysource>
		<sender>
			<sendertype>1</sendertype>
			<senderorganization>${escapeXml(data.company.name)}</senderorganization>
			<sendergivename>${escapeXml(senderName.given)}</sendergivename>
			<senderfamilyname>${escapeXml(senderName.family)}</senderfamilyname>${
        data.company.registeredAddress
          ? `
			<senderstreetaddress>${escapeXml(data.company.registeredAddress)}</senderstreetaddress>`
          : ''
      }
			<sendercountrycode>${data.company.homeCountry.isoCode}</sendercountrycode>${
        data.company.regulatoryContactPhone
          ? `
			<sendertel>${escapeXml(data.company.regulatoryContactPhone)}</sendertel>`
          : ''
      }${
        data.company.regulatoryContactEmail
          ? `
			<senderemailaddress>${escapeXml(data.company.regulatoryContactEmail)}</senderemailaddress>`
          : ''
      }
		</sender>
		<receiver>
			<receivertype>2</receivertype>
			<receiverorganization>${escapeXml(receiverIdentifier)}</receiverorganization>
			<receivercountrycode>${data.countryOfReport.isoCode}</receivercountrycode>
		</receiver>
		<patient>
			<patientinitial>${escapeXml(data.patient?.initials ?? 'UNKNOWN')}</patientinitial>${
        data.patient && mapPatientSex(data.patient.sex)
          ? `
			<patientsex>${mapPatientSex(data.patient.sex)}</patientsex>`
          : ''
      }
${reactionsXml}
${drugsXml}
			<summary>
				<narrativeincludeclinical>${escapeXml(buildNarrative(data))}</narrativeincludeclinical>
			</summary>
		</patient>
	</safetyreport>
</ichicsr>
`
  }
}
