import { CapaAllocationDto } from '../../internal-audit/dto/capa-allocation.dto'

/** Pass A2 — a Deviation's CAPA uses the same allocation rules as every other CAPA (owner, separate due dates, root cause). */
export class OpenCapaForDeviationDto extends CapaAllocationDto {}
