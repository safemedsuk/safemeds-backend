import { IsString } from 'class-validator'

export class ImportRecallDistributionDto {
  /** Raw CSV text — header row + rows, per the Engineering Build Package's §7 import-template contract: `toOrgName, batchNumber, qtyUnits, qtyPacks, date, invoiceNo`. */
  @IsString()
  csv!: string
}
