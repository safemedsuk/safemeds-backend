import { PartialType } from '@nestjs/swagger'

import { CreateRecallRuleDto } from './create-recall-rule.dto'

/**
 * A rule is otherwise version-on-write via its parent `RecallRuleSet`
 * (a new rule-set version means a whole new set of `RecallRule` rows) —
 * this update path exists only for fixing a draft rule-set's own rules
 * before sign-off, never for editing a `live` rule-set's rules in place.
 */
export class UpdateRecallRuleDto extends PartialType(CreateRecallRuleDto) {}
