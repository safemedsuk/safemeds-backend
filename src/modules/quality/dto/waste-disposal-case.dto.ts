import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

/**
 * Pass B (item B) — DTOs for the 7-step pharmaceutical waste disposal case.
 * Every reference to another record (product, batch) is a UUID the frontend
 * obtains from a picker — clients never type one. Evidence files are NOT
 * referenced by id here: they are uploaded through the case's own evidence
 * endpoint, which links them in the same request (see the controller).
 */

/**
 * Real-usage item (7 Oct 2026) — one product/batch pair weighed as part of
 * a multi-product disposal case.
 */
export class CreateWasteDisposalCaseItemDto {
  @IsUUID()
  productId!: string

  @IsUUID()
  batchId!: string
}

/**
 * Step 1 — waste put into a cage and weighed. Several products, each its
 * own batch, are often weighed together as one lot — `items` is the real
 * list (at least one). `productId`/`batchId` are accepted for backward
 * compatibility with any caller still sending a single pair, and are
 * folded into a one-entry `items` list.
 */
export class CreateWasteDisposalCaseDto {
  @IsOptional()
  @IsUUID()
  productId?: string

  @IsOptional()
  @IsUUID()
  batchId?: string

  @IsOptional()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateWasteDisposalCaseItemDto)
  items?: CreateWasteDisposalCaseItemDto[]

  @IsString()
  @Length(2, 300)
  wasteDescription!: string

  /** Kept as a string (matching `WasteDisposalRecord.quantity`) so decimals like "12.5" round-trip exactly. */
  @IsString()
  @Length(1, 40)
  quantity!: string

  @IsString()
  @Length(1, 40)
  unit!: string

  @IsDateString()
  weighedAt!: string
}

/** Step 2 — application to the Board (Second Schedule Part A form) and the statutory fee (Part B). */
export class RecordWasteApplicationDto {
  @IsString()
  @Length(1, 120)
  applicationReference!: string

  @IsString()
  @Length(1, 120)
  invoiceReference!: string

  @IsInt()
  @Min(1)
  @Max(10_000_000)
  feeAmountKes!: number

  @IsDateString()
  applicationSubmittedAt!: string
}

/** Step 4 — handover to an authorised disposal company (regulation r.11(3)). */
export class RecordWasteHandoverDto {
  @IsString()
  @Length(2, 200)
  disposalCompanyName!: string

  @IsDateString()
  handedOverAt!: string
}

/** Step 5 — destruction date and location (under the Board's supervision, r.17(1)). */
export class RecordWasteDestructionDto {
  @IsDateString()
  destructionDate!: string

  @IsString()
  @Length(2, 300)
  destructionLocation!: string
}

export const WASTE_ATTENDEE_ROLES = ['client_representative', 'ppb_officer', 'other'] as const

/** Step 5 — a person present at destruction (client representative, PPB officer, or other). */
export class AddWasteDestructionAttendeeDto {
  @IsString()
  @Length(2, 120)
  name!: string

  @IsString()
  @Length(2, 200)
  organisation!: string

  @IsIn(WASTE_ATTENDEE_ROLES)
  attendeeRole!: (typeof WASTE_ATTENDEE_ROLES)[number]
}

export class ListWasteDisposalCasesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['open', 'closed'])
  status?: 'open' | 'closed'
}
