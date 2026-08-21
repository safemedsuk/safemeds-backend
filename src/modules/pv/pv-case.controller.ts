import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RegulatorySubmissionService } from '../regulatory-submission/regulatory-submission.service'
import { CaseFollowUpService } from './case-follow-up.service'
import { CausalityService } from './causality.service'
import { CodingService } from './coding.service'
import { AssessCausalityDto } from './dto/assess-causality.dto'
import { AssessExpectednessDto } from './dto/assess-expectedness.dto'
import { ClassifyCaseDto } from './dto/classify-case.dto'
import { CodeAdverseEventDto } from './dto/code-adverse-event.dto'
import { CodeSuspectProductDto } from './dto/code-suspect-product.dto'
import {
  AdverseEventInputDto,
  CreatePvCaseDto,
  PatientInputDto,
  ReporterInputDto,
  SuspectProductInputDto,
} from './dto/create-pv-case.dto'
import { LinkSourceDocumentDto } from './dto/link-source-document.dto'
import { ListPvCasesQueryDto } from './dto/list-pv-cases-query.dto'
import { MarkRedactedDto } from './dto/mark-redacted.dto'
import { DuplicateDetectionService } from './duplicate-detection.service'
import { ExpectednessService } from './expectedness.service'
import { PvCaseService } from './pv-case.service'
import { SourceDocumentService } from './source-document.service'
import { TriageService } from './triage.service'

@ApiTags('pv-cases')
@Controller('pv/cases')
export class PvCaseController {
  constructor(
    private readonly pvCaseService: PvCaseService,
    private readonly sourceDocumentService: SourceDocumentService,
    private readonly triageService: TriageService,
    private readonly codingService: CodingService,
    private readonly expectednessService: ExpectednessService,
    private readonly causalityService: CausalityService,
    private readonly duplicateDetectionService: DuplicateDetectionService,
    private readonly caseFollowUpService: CaseFollowUpService,
    private readonly regulatorySubmissionService: RegulatorySubmissionService,
  ) {}

  @RequirePermissions('pv.capture_case')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePvCaseDto,
    @Req() req: Request,
  ) {
    return this.pvCaseService.create(user, dto, { ip: req.ip })
  }

  // No @RequirePermissions here — `PvCaseService.list()`'s own
  // `resolveViewScope()` enforces that the actor holds at least
  // `pv.capture_case` (own-only) or `pv.view_all`/`records.view_all` (all),
  // and throws Forbidden otherwise. A single ANDed `@RequirePermissions()`
  // can't express that "either of these" gate.
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPvCasesQueryDto) {
    return this.pvCaseService.list(user, query)
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pvCaseService.get(user, id)
  }

  /**
   * Stage 1 tasks 1.4/4.2 — a case stuck at the Validity Gate (missing an
   * identifiable patient/reporter/product/event) previously had no way
   * to actually be fixed. These four are deliberately narrow: only the
   * fields `ValidityGateService`'s own four criteria check, and only
   * while the case is still at Intake (see `PvCaseService.requireCaseAtIntake()`'s
   * own doc comment for why). Gated by `pv.capture_case` — the same
   * permission that lets someone create a case in the first place.
   */
  @RequirePermissions('pv.capture_case')
  @Patch(':id/reporter')
  updateReporter(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReporterInputDto,
    @Req() req: Request,
  ) {
    return this.pvCaseService.updateReporter(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('pv.capture_case')
  @Patch(':id/patient')
  updatePatient(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PatientInputDto,
    @Req() req: Request,
  ) {
    return this.pvCaseService.updatePatient(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('pv.capture_case')
  @Post(':id/suspect-products')
  addSuspectProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SuspectProductInputDto,
    @Req() req: Request,
  ) {
    return this.pvCaseService.addSuspectProduct(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('pv.capture_case')
  @Post(':id/adverse-events')
  addAdverseEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdverseEventInputDto,
    @Req() req: Request,
  ) {
    return this.pvCaseService.addAdverseEvent(user, id, dto, { ip: req.ip })
  }

  /**
   * VigiCloud Stage 3 — the human-confirmation step for a system-channel
   * case (public URL/email/WhatsApp). Gated by `pv.triage_case`, not
   * `pv.capture_case` — confirming someone else's (or nobody's) draft is
   * a triage action, matching who the seeded `pv_case` workflow already
   * trusts to move a case out of Intake.
   */
  @RequirePermissions('pv.triage_case')
  @Post(':id/confirm-draft')
  confirmDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.pvCaseService.confirmDraft(user, id, { ip: req.ip })
  }

  /** Real-usage feedback, 19 Aug 2026 — claim a draft-review case before working it, matching the Task Inbox's own claim/release pattern. */
  @RequirePermissions('pv.triage_case')
  @Post(':id/claim-draft')
  claimDraft(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.pvCaseService.claimDraft(user, id, { ip: req.ip })
  }

  @RequirePermissions('pv.triage_case')
  @Post(':id/release-draft')
  releaseDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.pvCaseService.releaseDraft(user, id, { ip: req.ip })
  }

  /**
   * VigiCloud Stage 5 — derives (or accepts an explicit override of) the
   * case's seriousness and computes/recomputes its real legal reporting
   * deadline. Gated by `pv.triage_case`, callable any number of times —
   * reclassification mid-case is the normal path, not an edge case.
   */
  @RequirePermissions('pv.triage_case')
  @Post(':id/triage')
  classify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ClassifyCaseDto,
    @Req() req: Request,
  ) {
    return this.triageService.classify(user, id, dto, { ip: req.ip })
  }

  /**
   * VigiCloud Stage 7 — assigns a MedDRA term to one of this case's
   * adverse events. Gated by `pv.medical_review` ("Medical review and
   * MedDRA coding confirmation" — the permission's own seeded
   * description already anticipated exactly this).
   */
  @RequirePermissions('pv.medical_review')
  @Post(':id/adverse-events/:aeId/code')
  codeAdverseEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('aeId') aeId: string,
    @Body() dto: CodeAdverseEventDto,
    @Req() req: Request,
  ) {
    return this.codingService.codeAdverseEvent(user, id, aeId, dto, { ip: req.ip })
  }

  /** VigiCloud Stage 7 — assigns a WHODrug term to one of this case's suspect/concomitant products. Same gate as MedDRA coding above. */
  @RequirePermissions('pv.medical_review')
  @Post(':id/suspect-products/:spId/code')
  codeSuspectProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('spId') spId: string,
    @Body() dto: CodeSuspectProductDto,
    @Req() req: Request,
  ) {
    return this.codingService.codeSuspectProduct(user, id, spId, dto, { ip: req.ip })
  }

  /**
   * VigiCloud Stage 6 — records a manual expectedness/listedness
   * judgment. **Gated by `pv.qc_review` as of Stage 9** — this closes
   * the loop Stage 6/7's own doc comments explicitly left open ("may
   * move to a dedicated permission once Stage 9 builds real
   * reviewer-role separation"): Stage 9's own build-spec text says
   * plainly "QC review is where the Stage 6 manual expectedness flag is
   * set," so it moved off the interim `pv.medical_review` stopgap onto
   * the real QC-reviewer permission (`QUALITY_ASSOCIATE`) now that one
   * exists.
   */
  @RequirePermissions('pv.qc_review')
  @Post(':id/expectedness')
  assessExpectedness(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssessExpectednessDto,
    @Req() req: Request,
  ) {
    return this.expectednessService.assess(user, id, dto, { ip: req.ip })
  }

  /**
   * VigiCloud Stage 8 — records a WHO-UMC category and/or a Naranjo
   * answer set for one (suspect product × adverse event) pair. Both
   * dimensions are independent — a single call may set one, the other,
   * or both. Gated by `pv.medical_review` (the same permission that
   * already owns MedDRA coding — "Medical review and MedDRA coding
   * confirmation" per its own seeded description, and the seeded
   * `pv_case` workflow already trusts QPPV with the Medical Review →
   * Coding transition this assessment gates).
   */
  @RequirePermissions('pv.medical_review')
  @Post(':id/causality-assessments/:assessmentId')
  assessCausality(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('assessmentId') assessmentId: string,
    @Body() dto: AssessCausalityDto,
    @Req() req: Request,
  ) {
    return this.causalityService.assess(user, id, assessmentId, dto, { ip: req.ip })
  }

  @RequirePermissions('documents.manage')
  @Post(':id/source-documents')
  linkSourceDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: LinkSourceDocumentDto,
    @Req() req: Request,
  ) {
    return this.sourceDocumentService.link(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('documents.view')
  @Get(':id/source-documents')
  listSourceDocuments(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sourceDocumentService.list(user, id)
  }

  /** VigiCloud Stage 10 — every `possible`/`confirmed_duplicate`/`not_duplicate` review touching this case, in either direction (as the detecting case or the matched one), driving the case detail page's "possible duplicate" banner. */
  @RequirePermissions('pv.triage_case')
  @Get(':id/duplicate-reviews')
  listDuplicateReviews(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.duplicateDetectionService.listForCase(user, id)
  }

  /** VigiCloud Stage 11 — starts (or, idempotently, returns) this case's follow-up cycle. */
  @RequirePermissions('pv.triage_case')
  @Post(':id/follow-up')
  startFollowUp(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.caseFollowUpService.start(user, id, { ip: req.ip })
  }

  /** VigiCloud Stage 11 — the follow-up timeline (attempt 1/2 status, days-remaining) for the case detail page; `null` if no cycle has been started yet. */
  @RequirePermissions('pv.triage_case')
  @Get(':id/follow-up')
  getFollowUp(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.caseFollowUpService.get(user, id)
  }

  /**
   * VigiCloud Stage 12 — generates a real E2B(R3) XML + human-readable
   * PDF for a case that has cleared QC review (`submission_ready`).
   * Gated by `pv.sign_icsr` — the permission seeded from day one
   * specifically for "sign and approve an ICSR submission," held only by
   * QPPV. Callable more than once per case (each call is a new
   * `submissionNumber` — the initial submission, or a later resubmission).
   */
  @RequirePermissions('pv.sign_icsr')
  @Post(':id/regulatory-submissions')
  generateRegulatorySubmission(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.regulatorySubmissionService.generate(user, id, { ip: req.ip })
  }

  /** VigiCloud Stage 12 — every generated submission attempt for this case, newest first. */
  @RequirePermissions('pv.view_all')
  @Get(':id/regulatory-submissions')
  listRegulatorySubmissions(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.regulatorySubmissionService.list(user, id)
  }
}

@ApiTags('pv-cases')
@Controller('pv/source-documents')
export class PvSourceDocumentController {
  constructor(private readonly sourceDocumentService: SourceDocumentService) {}

  @RequirePermissions('documents.manage')
  @Post(':id/redact')
  redact(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: MarkRedactedDto,
    @Req() req: Request,
  ) {
    return this.sourceDocumentService.markRedacted(user, id, dto, { ip: req.ip })
  }
}
