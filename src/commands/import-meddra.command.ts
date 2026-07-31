import { Injectable, Logger } from '@nestjs/common'
import { readFileSync } from 'fs'
import { Command, CommandRunner, Option } from 'nest-commander'
import { join } from 'path'

import { newId } from '../common/id'
import { PrismaService } from '../prisma/prisma.service'

interface ImportMeddraOptions {
  dir?: string
  versionLabel?: string
  releasedOn?: string
  dryRun?: boolean
}

/**
 * MedDRA level codes as they appear in the MSSO ASCII release's
 * `$`-delimited files (`MedAscii/soc.asc`, `hlgt.asc`, `hlt.asc`, `pt.asc`,
 * `llt.asc`, plus the `hlgt_hlt.asc`/`hlt_pt.asc` relationship files that
 * carry the hierarchy links — PT/LLT already embed their own parent code
 * as a column, SOC/HLGT/HLT link via the separate relationship files).
 * This is the MSSO's own publicly documented ASCII load format, not
 * proprietary parsing logic — what's actually licence-gated is the release
 * *data* itself, not the ability to read its shape.
 *
 * ⚠️ UNTESTED against a real release: MedDRA licensing is blocked
 * (flagged to the CEO per the build spec), so there is no licensed file to
 * validate this parser against yet. Treat this as a scaffold to verify
 * carefully against the first real release obtained, not as
 * production-proven code. Until then, `prisma/meddra.seed-data.ts`'s
 * mock subset is what the rest of the app is built and tested against.
 */
function parseAsciiFile(path: string): string[][] {
  const content = readFileSync(path, 'utf-8')
  return content
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => line.split('$'))
}

@Injectable()
@Command({
  name: 'import:meddra',
  description: 'Import a licensed MedDRA MSSO ASCII release into MeddraVersion/MeddraTerm',
})
export class ImportMeddraCommand extends CommandRunner {
  private readonly logger = new Logger(ImportMeddraCommand.name)

  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async run(_params: string[], options: ImportMeddraOptions): Promise<void> {
    if (!options.dir || !options.versionLabel || !options.releasedOn) {
      this.logger.error(
        'Usage: import:meddra --dir <path to extracted MedAscii/> --version-label <label> --released-on <YYYY-MM-DD> [--dry-run]',
      )
      process.exitCode = 1
      return
    }

    const socRows = parseAsciiFile(join(options.dir, 'soc.asc'))
    const hlgtRows = parseAsciiFile(join(options.dir, 'hlgt.asc'))
    const hltRows = parseAsciiFile(join(options.dir, 'hlt.asc'))
    const ptRows = parseAsciiFile(join(options.dir, 'pt.asc'))
    const lltRows = parseAsciiFile(join(options.dir, 'llt.asc'))
    const hlgtHltRows = parseAsciiFile(join(options.dir, 'hlgt_hlt.asc'))
    const hltPtRows = parseAsciiFile(join(options.dir, 'hlt_pt.asc'))

    // Column 0 is always the term code, column 1 its name, in every *.asc file.
    const hlgtByHlt = new Map(hlgtHltRows.map((row) => [row[1], row[0]])) // hlt_code -> hlgt_code
    const hltByPt = new Map(hltPtRows.map((row) => [row[1], row[0]])) // pt_code -> hlt_code
    // pt.asc's own row also carries soc_code (primary SOC) — column 3 in the documented format.
    const parentSocByPt = new Map(ptRows.map((row) => [row[0], row[3]]))
    // llt.asc carries its parent pt_code directly as column 2.
    const parentPtByLlt = new Map(lltRows.map((row) => [row[0], row[2]]))

    const total = socRows.length + hlgtRows.length + hltRows.length + ptRows.length + lltRows.length
    this.logger.log(
      `Parsed ${total} terms (${socRows.length} SOC, ${hlgtRows.length} HLGT, ${hltRows.length} HLT, ${ptRows.length} PT, ${lltRows.length} LLT).`,
    )

    if (options.dryRun) {
      this.logger.log('Dry run — no rows written.')
      return
    }

    await this.prisma.$transaction(async (tx) => {
      const version = await tx.meddraVersion.create({
        data: {
          id: newId(),
          versionLabel: options.versionLabel!,
          releasedOn: new Date(options.releasedOn!),
        },
      })

      const idByCode = new Map<string, string>()
      const upsertTerm = async (
        code: string,
        name: string,
        level: 'SOC' | 'HLGT' | 'HLT' | 'PT' | 'LLT',
        parentCode?: string,
      ) => {
        const id = newId()
        idByCode.set(code, id)
        await tx.meddraTerm.create({
          data: {
            id,
            versionId: version.id,
            code,
            name,
            level,
            parentId: parentCode ? idByCode.get(parentCode) : undefined,
          },
        })
      }

      for (const [code, name] of socRows) await upsertTerm(code, name, 'SOC')
      for (const [code, name] of hlgtRows) await upsertTerm(code, name, 'HLGT')
      for (const [code, name] of hltRows) await upsertTerm(code, name, 'HLT', hlgtByHlt.get(code))
      for (const [code, name] of ptRows)
        await upsertTerm(code, name, 'PT', hltByPt.get(code) ?? parentSocByPt.get(code))
      for (const [code, name] of lltRows)
        await upsertTerm(code, name, 'LLT', parentPtByLlt.get(code))

      this.logger.log(
        `Imported MedDRA ${options.versionLabel} (${total} terms) as version ${version.id}.`,
      )
    })
  }

  @Option({ flags: '--dir <dir>', description: 'Path to the extracted MedAscii/ directory' })
  parseDir(value: string): string {
    return value
  }

  @Option({ flags: '--version-label <label>', description: 'Version label, e.g. "27.0"' })
  parseVersionLabel(value: string): string {
    return value
  }

  @Option({ flags: '--released-on <date>', description: 'Release date, YYYY-MM-DD' })
  parseReleasedOn(value: string): string {
    return value
  }

  @Option({
    flags: '--dry-run',
    description: 'Parse and report counts without writing to the database',
  })
  parseDryRun(): boolean {
    return true
  }
}
