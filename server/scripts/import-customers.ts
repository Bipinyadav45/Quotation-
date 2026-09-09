import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ROOT } from '../src/config.js'
import { closeDb, getDb } from '../src/db/client.js'
import { importDebtors, parseDebtors } from '../src/lib/importCustomers.js'

/**
 * npm run import:customers -- [path to the .xlsx]
 *
 * Loads Tally's Sundry Debtors export into the customer master. Safe to run
 * again on a refreshed export: rows are matched on the ledger name, so the
 * second run updates rather than duplicates. Pass --dry-run to see what it
 * WOULD do — worth doing first on an export nobody has checked.
 *
 * It prints every issue it found rather than a count, because every one of them
 * is a row in Tally somebody has to open: a GSTIN of the wrong shape, a state
 * that is not a state, or a state that disagrees with the GSTIN registered
 * against it. None of those stop the import.
 */

const DEFAULT_FILE = path.resolve(
  ROOT,
  'Resources',
  'List of Sundry Debtors with address and GSTIN.xlsx',
)

function main(): void {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const file = args.find((a) => !a.startsWith('--')) ?? DEFAULT_FILE

  console.log(`Reading ${path.relative(ROOT, file)}`)

  const { debtors, issues } = parseDebtors(readFileSync(file))
  console.log(`  ${debtors.length} ledgers read`)

  if (dryRun) {
    report(issues)
    console.log('\n--dry-run: nothing was written.')
    return
  }

  const result = importDebtors(getDb(), debtors, issues)
  console.log(
    `  ${result.added} added, ${result.updated} updated, ${result.unchanged} already current`,
  )
  report(result.issues)
}

function report(issues: ReturnType<typeof parseDebtors>['issues']): void {
  if (issues.length === 0) {
    console.log('\nNothing to fix in Tally.')
    return
  }

  console.log(`\n${issues.length} thing(s) to fix in Tally — the ledgers were imported anyway:`)
  for (const issue of issues) console.log(`  ${issue.ledger}\n    ${issue.message}`)
}

try {
  main()
} finally {
  closeDb()
}
