import { ApiProperty } from '@nestjs/swagger'
import { WhoUmcCausality } from '@prisma/client'
import { Type } from 'class-transformer'
import { IsEnum, IsIn, IsOptional, ValidateNested } from 'class-validator'

const NARANJO_ANSWER_VALUES = ['yes', 'no', 'unknown'] as const
export type NaranjoAnswerValue = (typeof NARANJO_ANSWER_VALUES)[number]

/** The exact 10 questions from `vigicloud docs/Naranjo-assessment.pdf`, in order — every question is mandatory once a Naranjo submission is made at all (a partial scale isn't a real score). */
export class NaranjoAnswersDto {
  @IsIn(NARANJO_ANSWER_VALUES)
  q1: NaranjoAnswerValue

  @IsIn(NARANJO_ANSWER_VALUES)
  q2: NaranjoAnswerValue

  @IsIn(NARANJO_ANSWER_VALUES)
  q3: NaranjoAnswerValue

  @IsIn(NARANJO_ANSWER_VALUES)
  q4: NaranjoAnswerValue

  @IsIn(NARANJO_ANSWER_VALUES)
  q5: NaranjoAnswerValue

  @IsIn(NARANJO_ANSWER_VALUES)
  q6: NaranjoAnswerValue

  @IsIn(NARANJO_ANSWER_VALUES)
  q7: NaranjoAnswerValue

  @IsIn(NARANJO_ANSWER_VALUES)
  q8: NaranjoAnswerValue

  @IsIn(NARANJO_ANSWER_VALUES)
  q9: NaranjoAnswerValue

  @IsIn(NARANJO_ANSWER_VALUES)
  q10: NaranjoAnswerValue
}

export class AssessCausalityDto {
  @ApiProperty({
    enum: WhoUmcCausality,
    required: false,
    description:
      'The WHO-UMC category. Submitted independently of Naranjo — a reviewer may fill in one, the other, or both in one call.',
  })
  @IsOptional()
  @IsEnum(WhoUmcCausality)
  whoUmcCategory?: WhoUmcCausality

  @ApiProperty({
    type: NaranjoAnswersDto,
    required: false,
    description:
      'All 10 Naranjo answers. The total score is always computed server-side from these — never accepted as a raw number from the client.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => NaranjoAnswersDto)
  naranjoAnswers?: NaranjoAnswersDto
}
