import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT } from '../config.js'
import { addressLines, importDebtors, ledgerKey, parseDebtors } from './importCustomers.js'
import { rankCandidates } from './customerMatch.js'
import type { CustomerRecord } from './customers.js'

/**
 * The debtors import, tested against THE REAL EXPORT.
 *
 * A hand-built fixture would prove the code runs and nothing else. Every
 * problem this file exists to handle came out of the actual spreadsheet: Tally
 * writing a `\x04` in front of "Not Applicable", an address flattened into one
 * cell with double commas where the line breaks were, a GSTIN with a trailing
 * carriage return, and a company whose sixteen ledgers make the name useless
 * as an identity. Reading the file the desk actually exported is the only way
 * those stay caught.
 */
const FILE = path.resolve(ROOT, 'Resources', 'List of Sundry Debtors with address and GSTIN.xlsx')
const SHEET = readFileSync(FILE)

const SCHEMA = ['001_init.sql', '002_customers.sql', '003_warranty.sql', '004_customer_identity.sql']
  .map((f) => readFileSync(path.resolve(ROOT, 'server', 'db', 'migrations', f), 'utf8'))
  .join('\n')

function db() {
  const d = new Database(':memory:')
  d.exec(SCHEMA)
  return d
}

const { debtors, issues } = parseDebtors(SHEET)
const find = (fragment: string) =>
  debtors.find((d) => d.name.toLowerCase().includes(fragment.toLowerCase()))!

describe('reading the export', () => {
  it('reads every ledger under the two title rows', () => {
    // The heading is on row 3, under the company name and "All Parties under:
    // Sundry Debtors". Found rather than assumed — an export with one title
    // line fewer must not shift every column.
    expect(debtors).toHaveLength(225)
  })

  it('gives every ledger a name', () => {
    expect(debtors.every((d) => d.name.trim() !== '')).toBe(true)
  })

  it('strips the control characters Tally writes into its own fields', () => {
    // "_x0004_ Not Applicable" and "_x000D_" are real values in this file. They
    // print as boxes on a quotation.
    for (const d of debtors) {
      const all = [d.name, d.address, d.state, d.country, d.regType, d.gstin].join('')
      // A newline is structure; every other control character is Tally
      // formatting that would print as a box on the quotation.
      for (const ch of all) {
        const code = ch.codePointAt(0) ?? 0
        expect(code === 10 || code > 31, JSON.stringify(d.name)).toBe(true)
      }
      expect(all).not.toMatch(/_x[0-9A-Fa-f]{4}_/)
    }
  })
})

describe('the address, whose line breaks Tally throws away', () => {
  it('restores the lines from the double commas that mark them', () => {
    // §11's address block prints one paragraph per line, so an address imported
    // flat prints as one long line running past its column.
    expect(find('Aadhar Housing').address).toBe(
      'Office No. 501 & 503, 5th Floor\nLight Bridge, Saki Vihar Road\nAndheri-East, Mumbai-400072',
    )
  })

  it('treats a real newline as the same marker', () => {
    // This row carries both: a literal carriage return AND the comma pair.
    expect(find('AXAR DIGITAL SERVICES PVT LTD (MUM)').address).toBe(
      'A 114-116, KAILAS BUSINESS PARK\nVEER SAVARKAR MARG\nVIKHROLI (W), MUMBAI - 400079',
    )
  })

  it('keeps the commas that are punctuation rather than structure', () => {
    // Only a PAIR marks a break. A single comma inside a line is how an address
    // is written, and splitting on it would give one word per line.
    expect(addressLines('Kharadi, Pune 411014')).toBe('Kharadi, Pune 411014')
  })

  it('drops the trailing comma Tally leaves on the line it broke', () => {
    expect(addressLines('G- 16,, MIDC SATPUR, NASHIK - 422007')).toBe(
      'G- 16\nMIDC SATPUR, NASHIK - 422007',
    )
  })

  it('drops a stray full stop left where a field was cleared', () => {
    expect(addressLines('PUNE - 411 006, .')).toBe('PUNE - 411 006')
  })

  it('survives three commas as readily as two', () => {
    expect(addressLines('Powai,,, Mumbai')).toBe('Powai\nMumbai')
  })

  it('leaves an address alone when there is nothing to restore', () => {
    expect(addressLines('')).toBe('')
  })

  it('rebuilds most of the list, not just the tidy rows', () => {
    const multiline = debtors.filter((d) => d.address.includes('\n'))
    expect(multiline.length).toBeGreaterThan(150)
  })
})

describe('the GSTIN, which goes on a tax document', () => {
  it('drops one of the wrong shape rather than storing half a number', () => {
    // "27MUMS49872E1D9" is in the real file and is not a GSTIN.
    expect(find('CBI SPECIAL UNIT').gstin).toBe('')
    expect(issues.some((i) => i.ledger === 'CBI SPECIAL UNIT')).toBe(true)
  })

  it('keeps one that only had a carriage return stuck to it', () => {
    // Same value, badly exported — not a malformed number. Dropping this one
    // would cost the desk a GSTIN they actually have.
    expect(find('BRISTLECONE INDIA LIMITED. - PUNE').gstin).toBe('27AAACM5186E1ZH')
  })

  it('stores every GSTIN it keeps in the one valid shape', () => {
    const shape = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/
    for (const d of debtors) if (d.gstin !== '') expect(d.gstin).toMatch(shape)
  })

  it('reports a state that disagrees with the GSTIN registered against it', () => {
    // Both are real rows. One of the two fields is wrong in Tally, and only the
    // desk knows which — so it is reported, never silently corrected. The
    // ship-to state decides IGST vs CGST+SGST.
    const said = issues.map((i) => `${i.ledger}: ${i.message}`).join('\n')
    expect(said).toMatch(/K\.M\. & CO\. \(SALE\)/)
    expect(said).toMatch(/registered in Gujarat/)
    expect(said).toMatch(/VALUE POINT SYSTEMS PVT\. LTD\. - HYD/)
    expect(said).toMatch(/registered in Telangana/)
  })
})

describe('the ship-to state, which decides the tax split', () => {
  it('leaves it blank for a ledger outside India rather than guessing', () => {
    // "Not Applicable" against a Hong Kong address is the correct value.
    const abroad = debtors.filter((d) => d.country !== 'India')
    expect(abroad.length).toBeGreaterThan(0)
    for (const d of abroad) expect(d.state).toBe('')
  })

  it('says so when an Indian ledger has no usable state', () => {
    const said = issues.map((i) => i.message).join('\n')
    expect(said).toMatch(/not an Indian state we recognise/)
    // ...and names the state the GSTIN is registered in, which turns the report
    // into an instruction. It is not filled in: registration is not ship-to.
    expect(said).toMatch(/The GSTIN is registered in Maharashtra/)
  })

  it('returns the canonical spelling, which is what taxModeForState matches on', () => {
    expect(debtors.filter((d) => d.state === 'maharashtra')).toHaveLength(0)
    expect(debtors.filter((d) => d.state === 'Maharashtra').length).toBeGreaterThan(100)
  })
})

describe('importing, and importing again', () => {
  it('adds every ledger the first time', () => {
    const d = db()
    const result = importDebtors(d, debtors, issues)

    expect(result.added).toBe(225)
    expect(result.updated).toBe(0)
    expect((d.prepare('SELECT count(*) AS n FROM customers').get() as { n: number }).n).toBe(225)
  })

  it('updates rather than duplicating on a second run', () => {
    // The desk re-exports from Tally whenever something changes. A second
    // import must not make a second copy of the list.
    const d = db()
    importDebtors(d, debtors, issues)
    const again = importDebtors(d, debtors, issues)

    expect(again.added).toBe(0)
    expect(again.unchanged).toBe(225)
    expect((d.prepare('SELECT count(*) AS n FROM customers').get() as { n: number }).n).toBe(225)
  })

  it('takes a changed address from a refreshed export', () => {
    // Tally is where a customer's move gets recorded first, so it wins.
    const d = db()
    importDebtors(d, debtors, issues)

    const moved = debtors.map((row) =>
      row.name === 'Adminneeds' ? { ...row, address: 'Somewhere else, Mumbai' } : row,
    )
    const again = importDebtors(d, moved, [])

    expect(again.updated).toBe(1)
    expect(
      (d.prepare('SELECT address FROM customers WHERE name = ?').get('Adminneeds') as {
        address: string
      }).address,
    ).toBe('Somewhere else, Mumbai')
  })

  it('leaves what the desk has learned by using a row', () => {
    // quote_count, last_used_at and the salesperson's own contact for this
    // account are not Tally's to overwrite.
    const d = db()
    importDebtors(d, debtors, issues)
    d.prepare(
      "UPDATE customers SET quote_count = 7, contact = '+91 22 1234', attention = 'Ms. Priya Nair' WHERE name = 'Adminneeds'",
    ).run()

    importDebtors(d, debtors, issues)

    const row = d.prepare('SELECT * FROM customers WHERE name = ?').get('Adminneeds') as Record<
      string,
      unknown
    >
    expect(row.quote_count).toBe(7)
    expect(row.contact).toBe('+91 22 1234')
    expect(row.attention).toBe('Ms. Priya Nair')
  })

  it('keeps two ledgers that share a GSTIN apart', () => {
    // Three Azentio sites hold 27AAUCA4876F1Z4 between them. A master that
    // merged on registration would bill two of them to the third's address.
    const d = db()
    importDebtors(d, debtors, issues)

    const sharing = d
      .prepare('SELECT name FROM customers WHERE gstin = ?')
      .all('27AAUCA4876F1Z4') as Array<{ name: string }>
    expect(sharing.length).toBe(3)
  })
})

describe('the ledger key', () => {
  it('folds case and inner spacing, and nothing else', () => {
    expect(ledgerKey('  AZENTIO   SOFTWARE PVT LTD (MALAD) ')).toBe(
      'azentio software pvt ltd (malad)',
    )
  })

  it('keeps the branch suffix that is the whole difference between two rows', () => {
    expect(ledgerKey('AZENTIO SOFTWARE PVT LTD (MALAD)')).not.toBe(
      ledgerKey('AZENTIO SOFTWARE PVT LTD (Vashi)'),
    )
  })

  it('is unique across the real export, which is what makes re-import safe', () => {
    expect(new Set(debtors.map((d) => ledgerKey(d.name))).size).toBe(debtors.length)
  })
})

/**
 * The matcher, asked the questions the real list makes hard. These numbers are
 * the reason a single best match was never a safe thing to apply.
 */
describe('shortlisting against the real list', () => {
  const ledgers: CustomerRecord[] = debtors.map((d, i) => ({
    id: `c${i}`,
    name: d.name,
    address: d.address,
    attention: '',
    gstin: d.gstin,
    state: d.state,
    contact: '',
    email: '',
    country: d.country,
    regType: d.regType,
    source: 'tally',
    quoteCount: 0,
    lastUsedAt: '2026-01-01T00:00:00.000Z',
  }))

  const shortlist = (name: string, gstin?: string) =>
    rankCandidates({ name, ...(gstin !== undefined ? { gstin } : {}) }, ledgers)

  it('offers every Azentio site, because six of them could be meant', () => {
    expect(shortlist('Azentio Software Pvt Ltd')).toHaveLength(6)
  })

  it('offers every Morgan Stanley entity, across ten GSTINs', () => {
    const found = shortlist('Morgan Stanley')
    expect(found.length).toBeGreaterThanOrEqual(10)
    expect(new Set(found.map((c) => c.record.gstin)).size).toBeGreaterThan(1)
    // ...and more than one ship-to state, which is what decides the tax split.
    expect(new Set(found.map((c) => c.record.state)).size).toBeGreaterThan(1)
  })

  it('finds a company written the long way when the list writes it short', () => {
    // "Pvt Ltd" on the list, "Private Limited" in the thread. The corporate form
    // is stripped from both, so the two still meet.
    expect(shortlist('Azentio Software Private Limited').length).toBe(6)
  })

  it('does not drag in a company that merely shares a common word', () => {
    for (const candidate of shortlist('Blue Star Limited')) {
      expect(candidate.record.name.toLowerCase()).toContain('blue')
    }
  })

  it('finds nothing for a company that is genuinely not on the list', () => {
    expect(shortlist('Kirloskar Brothers Limited')).toEqual([])
  })

  it('puts the ledger whose GSTIN the thread quoted first', () => {
    const found = shortlist('Azentio Software Pvt Ltd', '33AAUCA4876F1ZB')
    expect(found[0]?.record.name).toContain('CHENNAI')
    expect(found[0]?.gstinMatch).toBe(true)
  })

  it('still returns three when the quoted GSTIN is one that three ledgers share', () => {
    // The case that proves a GSTIN cannot decide on its own either.
    const found = shortlist('Azentio Software Pvt Ltd', '27AAUCA4876F1Z4')
    expect(found.filter((c) => c.gstinMatch)).toHaveLength(3)
  })
})
