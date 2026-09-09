import PizZip from 'pizzip'

/**
 * Just enough .xlsx to read a Tally export.
 *
 * A dependency was considered and not taken. `xlsx` is 7 MB and has carried
 * prototype-pollution and ReDoS advisories; this reads ONE sheet of ONE
 * spreadsheet that a human exports by hand, and needs no formulas, no dates, no
 * styles and no writing. An .xlsx is a zip of XML and pizzip is already here
 * for docxtemplater, so the whole of it is the eighty lines below.
 *
 * Everything comes back as a STRING, deliberately. Every column of a debtors
 * list is text — a GSTIN is not a number, a pincode with a leading zero is not
 * a number, and "Sl No." is a label. Nothing here should be able to turn
 * 27AABCD... into anything else.
 */

/** A1 -> 0, Z1 -> 25, AA1 -> 26. */
function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? ''
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/**
 * XML entities, then OOXML's own escape for characters it cannot hold
 * literally: `_x000D_` for a carriage return, `_x0004_` for the end-of-transmit
 * byte Tally writes in front of "Not Applicable".
 *
 * The escapes are decoded rather than stripped as text, because decoding is
 * what makes the result the string the spreadsheet actually holds — and then
 * the control characters it turns out to hold are dropped in `clean` below,
 * where dropping them is a stated decision rather than a regex that happened
 * to match.
 */
function decode(xml: string): string {
  return xml
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Ampersand LAST: decoding it first would let "&amp;lt;" become "<".
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
}

/** The text of one `<si>` or `<is>`, whose runs may be split across many `<t>`. */
function textOf(fragment: string): string {
  let out = ''
  for (const run of fragment.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) out += decode(run[1]!)
  return out
}

/**
 * The first worksheet as a grid of strings, one array per row, blank cells
 * included so column position is stable — a row whose Address is empty must not
 * shift its GSTIN one column left.
 */
export function readSheet(file: Buffer): string[][] {
  const zip = new PizZip(file)

  const sharedFile = zip.file('xl/sharedStrings.xml')
  const shared: string[] = []
  if (sharedFile) {
    for (const si of sharedFile.asText().matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(textOf(si[1]!))
    }
  }

  const sheetFile = zip.file('xl/worksheets/sheet1.xml') ?? zip.file(/^xl\/worksheets\/.*\.xml$/)[0]
  if (!sheetFile) throw new Error('No worksheet found in the spreadsheet')

  const rows: string[][] = []
  // A row with no cells at all is self-closing and has no </row>; matching only
  // the paired form would silently renumber everything after a blank row.
  const ROW = /<row[^>]*\br="(\d+)"[^>]*(?:\/>|>([\s\S]*?)<\/row>)/g
  const CELL = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g

  for (const rm of sheetFile.asText().matchAll(ROW)) {
    const cells: string[] = []
    for (const cm of (rm[2] ?? '').matchAll(CELL)) {
      const attrs = cm[1]!
      const inner = cm[2] ?? ''
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1]
      if (!ref) continue

      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n'
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]

      let value = ''
      if (type === 's') value = shared[Number(raw)] ?? ''
      else if (type === 'inlineStr') value = textOf(inner)
      else if (raw !== undefined) value = decode(raw)

      const at = columnIndex(ref)
      while (cells.length < at) cells.push('')
      cells[at] = value
    }

    const at = Number(rm[1]) - 1
    while (rows.length < at) rows.push([])
    rows[at] = cells
  }

  return rows
}

/**
 * Text out of a spreadsheet cell, fit to store.
 *
 * Tally's export carries the control characters its own screens use for
 * layout — a `\x04` before "Not Applicable", and carriage returns and tabs
 * inside an address where somebody made a Tally field wrap. They are not part
 * of the value and they print as boxes on a quotation.
 *
 * Newlines SURVIVE, because an address is a shape as well as a string: the
 * document prints one paragraph per line, and flattening it here is exactly the
 * corruption extractCustomer's lostLineStructure exists to repair.
 */
export function clean(value: string): string {
  return (
    value
      .replace(/\r\n?/g, '\n')
      // Every other C0 control, and the tabs Tally pads fields with.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/[^\S\n]+/g, ' ')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .join('\n')
      .trim()
  )
}
