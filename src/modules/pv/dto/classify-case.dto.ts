import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional } from 'class-validator'

import { SeriousnessClass } from '../triage.service'

const SERIOUSNESS_CLASSES: SeriousnessClass[] = ['fatal', 'serious', 'non_serious']

/** VigiCloud Stage 5 — `seriousnessClass` is optional: omit it to let `TriageService.classify()` auto-derive from the case's own captured `AdverseEvent` seriousness flags (the normal path); provide it to override the derived value for a genuine clinical judgment call the checkboxes alone can't capture. */
export class ClassifyCaseDto {
  @ApiPropertyOptional({ enum: SERIOUSNESS_CLASSES })
  @IsOptional()
  @IsIn(SERIOUSNESS_CLASSES)
  seriousnessClass?: SeriousnessClass
}
