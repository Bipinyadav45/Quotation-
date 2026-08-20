/**
 * Rebuilds server/templates/quotation-template.docx from the hand-made
 * letterhead — CORRECTION 1.
 *
 *   npm run build:template
 *
 * §8 says to take the existing .docx, delete the body content and leave
 * docxtemplater tags in place. The complication the real file presents is that
 * the entire body lives inside a floating TEXT BOX (`w:txbxContent`), not in
 * `w:body`. docxtemplater's {#items} loop works on `w:tr` nodes and is fragile
 * inside one — and that text box is also why the layout shifts whenever staff
 * edit the document today.
 *
 * So the body is rebuilt as ordinary paragraphs and a real table. Everything
 * that carries the brand is copied across untouched:
 *
 *   word/header1.xml   the logo            byte-identical
 *   word/footer1.xml   address + CIN rule  byte-identical
 *   word/styles.xml    12pt Times New Roman byte-identical
 *   word/media/*       the logo image      byte-identical
 *   w:sectPr           page size, header/footer references
 *
 * GEOMETRY. The original page has NO margins (`w:pgMar` is all zeros) because
 * the text box supplied the inset: it sat at 34pt from the left and was
 * 524.15pt wide, and its tables are 9464 twips across. Setting real left/right
 * page margins would be the obvious move and is WRONG — the header table is
 * 11382 twips wide, sized for a zero-margin page, so margins would push the
 * logo out of place. Instead the left/right margins stay at zero and the body
 * content is indented by hand, which reproduces the original text position and
 * leaves the header and footer exactly as they were.
 */

import PizZip from 'pizzip'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ROOT } from '../src/config.js'

const SOURCE = path.resolve(ROOT, 'Quotation -- Format.docx')
const TARGET = path.resolve(ROOT, 'server', 'templates', 'quotation-template.docx')

// --- geometry, all in twips (1/20 pt) --------------------------------------
const BODY_INDENT_LEFT = 824 // 34pt text-box offset + its 0.1" internal inset
const BODY_WIDTH = 9464 // the width the original tables actually are
const PAGE_WIDTH = 11909 // A4
const BODY_INDENT_RIGHT = PAGE_WIDTH - BODY_INDENT_LEFT - BODY_WIDTH // 1621

/** Two columns, as the original address block. 4577 + 4887 = 9464. */
const HEADER_COLS = [4577, 4887]

/**
 * The item table, exactly as the letterhead has it: five columns totalling
 * 9493 twips.
 *
 * There was a sixth here — a Make column, added because §7 asked for one. It is
 * gone. The instruction is to reproduce this document and add nothing to it,
 * and a column the letterhead does not have is an addition however useful.
 */
const ITEM_COLS = [562, 5103, 1276, 851, 1701]

// --- XML helpers -----------------------------------------------------------

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * 12pt in the letterhead's own face.
 *
 * Deliberately specifies NO font. Of the 166 text-bearing runs in the original,
 * 158 carry no `w:rFonts` at all and 8 name Times New Roman; none use anything
 * else. So the faithful thing is to inherit from `docDefaults` in styles.xml —
 * which is Times New Roman, and which we copy across byte-identical. Naming a
 * face here would also mean this file silently disagreeing with the letterhead
 * the day someone restyles it.
 *
 * (An earlier version hard-coded Arial, read off a scan of every font
 * *referenced* anywhere in the package rather than the fonts the body actually
 * uses. It rendered the whole quotation in the wrong face.)
 */
function rPr(opts: { bold?: boolean; italic?: boolean } = {}): string {
  return (
    '<w:rPr>' +
    (opts.bold ? '<w:b/><w:bCs/>' : '') +
    (opts.italic ? '<w:i/>' : '') +
    '<w:sz w:val="24"/><w:szCs w:val="24"/>' +
    '</w:rPr>'
  )
}

interface RunOpts {
  bold?: boolean
  italic?: boolean
  /**
   * Bold only these lines of a multi-line cell. The letterhead bolds "To:" and
   * the company name under "From:" but not the address lines beneath either.
   */
  boldLines?: number[]
}

/** Text with \n turned into real line breaks and \t into tabs. */
function runs(text: string, opts: RunOpts = {}): string {
  if (text === '') return ''
  return text
    .split('\n')
    .map((lineText, lineIndex) => {
      const parts = lineText.split('\t')
      const inner = parts
        .map((part, i) => {
          const tab = i > 0 ? '<w:tab/>' : ''
          return part === ''
            ? tab
            : `${tab}<w:t xml:space="preserve">${esc(part)}</w:t>`
        })
        .join('')
      const bold = opts.bold || opts.boldLines?.includes(lineIndex) === true
      return `<w:r>${rPr({ ...opts, bold })}${lineIndex > 0 ? '<w:br/>' : ''}${inner}</w:r>`
    })
    .join('')
}

interface ParaOpts extends RunOpts {
  align?: 'left' | 'center' | 'right'
  /**
   * A named style from the letterhead's own styles.xml, which we copy
   * byte-identical. "Quotation" is a Heading5 there, and Heading5 carries the
   * centring, the bold and the underline — none of which appear on the
   * paragraph itself. Reading only direct formatting rendered that heading as
   * plain left-aligned text, which is exactly what it looked like.
   */
  style?: string
  /** Suppress the standard body indent — used inside table cells. */
  bare?: boolean
  spaceAfter?: number
  tabs?: number[]
}

function p(text = '', opts: ParaOpts = {}): string {
  const style = opts.style ? `<w:pStyle w:val="${opts.style}"/>` : ''
  const ind = opts.bare
    ? ''
    : `<w:ind w:left="${BODY_INDENT_LEFT}" w:right="${BODY_INDENT_RIGHT}"/>`
  const jc = opts.align && opts.align !== 'left' ? `<w:jc w:val="${opts.align}"/>` : ''
  const spacing = `<w:spacing w:after="${opts.spaceAfter ?? 0}" w:line="240" w:lineRule="auto"/>`
  const tabs = opts.tabs?.length
    ? `<w:tabs>${opts.tabs.map((pos) => `<w:tab w:val="left" w:pos="${pos}"/>`).join('')}</w:tabs>`
    : ''
  return `<w:p><w:pPr>${style}${spacing}${ind}${tabs}${jc}</w:pPr>${runs(text, opts)}</w:p>`
}

const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`)
    .join('') +
  '</w:tblBorders>'

interface CellOpts extends RunOpts {
  align?: 'left' | 'center' | 'right'
  /** Merge horizontally across this many columns. */
  span?: number
}

function tc(width: number, text: string, opts: CellOpts = {}): string {
  const span = opts.span && opts.span > 1 ? `<w:gridSpan w:val="${opts.span}"/>` : ''
  return (
    '<w:tc>' +
    `<w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span}<w:vAlign w:val="top"/></w:tcPr>` +
    p(text, { ...opts, bare: true }) +
    '</w:tc>'
  )
}

function tr(cells: string): string {
  return `<w:tr>${cells}</w:tr>`
}

function tbl(cols: number[], rows: string[], opts: { borders?: boolean } = {}): string {
  const total = cols.reduce((a, b) => a + b, 0)
  return (
    '<w:tbl>' +
    '<w:tblPr>' +
    `<w:tblW w:w="${total}" w:type="dxa"/>` +
    `<w:tblInd w:w="${BODY_INDENT_LEFT}" w:type="dxa"/>` +
    (opts.borders === false ? '' : BORDERS) +
    '<w:tblLayout w:type="fixed"/>' +
    '<w:tblLook w:val="0000"/>' +
    '</w:tblPr>' +
    `<w:tblGrid>${cols.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
    rows.join('') +
    '</w:tbl>'
  )
}

// --- the document body -----------------------------------------------------

function buildBody(sectPr: string): string {
  const [c1, c2] = HEADER_COLS as [number, number]
  const [sr, desc, rate, qty, amount] = ITEM_COLS as [number, number, number, number, number]

  // Header block. Ref and Date share one merged cell; "To:" is bold and so is
  // the company name under "From:"; Kind Attention is centred and bold.
  const addressBlock = tbl(HEADER_COLS, [
    tr(tc(c1 + c2, 'Ref: {ref}\nDate: {dateLong}', { span: 2 })),
    tr(
      tc(c1, 'To: \n{customerName}\n{customerAddress}', { boldFirstLine: true }) +
        tc(
          c2,
          'From: \nNewtech Computer Services Pvt. Ltd.\n6th Floor, Solaris-II, Opp L&T Gate-6,\nSaki Vihar Road, Powai,\nMumbai-400072.',
          { boldLine: 1 },
        ),
    ),
    tr(tc(c1, 'Contact Number:{contact}') + tc(c2, 'Email: {email}')),
    tr(tc(c1 + c2, 'Kind Attention: {attention}', { span: 2, bold: true, align: 'center' })),
  ])

  const itemsTable = tbl(ITEM_COLS, [
    tr(
      tc(sr, 'Sr. No', { bold: true, align: 'center' }) +
        tc(desc, 'Product Name and Description', { bold: true, align: 'center' }) +
        tc(rate, 'Rate (Rupees)', { bold: true, align: 'center' }) +
        tc(qty, 'Qty.', { bold: true, align: 'center' }) +
        tc(amount, 'Amount\n(Rupees)', { bold: true, align: 'center' }),
    ),
    // docxtemplater expands the whole row: the opening and closing tags are in
    // the same one.
    tr(
      tc(sr, '{#items}{sr}', { align: 'center' }) +
        tc(desc, '{desc}') +
        tc(rate, '{rate}', { align: 'right' }) +
        tc(qty, '{qty}', { align: 'center' }) +
        tc(amount, '{amount}{/items}', { align: 'right' }),
    ),
    tr(
      tc(sr, '') +
        tc(desc, 'Sub Total', { align: 'center' }) +
        tc(rate, '') +
        tc(qty, '') +
        tc(amount, '{subTotal}', { align: 'right' }),
    ),
    tr(
      tc(sr, '') +
        tc(desc, '{#taxRows}{taxLabel}', { align: 'center' }) +
        tc(rate, '') +
        tc(qty, '') +
        tc(amount, '{taxAmount}{/taxRows}', { align: 'right' }),
    ),
    tr(
      tc(sr, '') +
        tc(desc, 'Total Amount', { align: 'center', bold: true }) +
        tc(rate, '') +
        tc(qty, '') +
        tc(amount, '{grandTotal}', { align: 'right', bold: true }),
    ),
  ])

  /**
   * Paragraph for paragraph as the letterhead has it, blank lines included.
   * The tabs are the document's own; it relies on Word's default tab stops, so
   * no custom ones are set here either.
   *
   * Nothing has been added. An "Amount in words" line used to sit under the
   * table; it is not on the letterhead, so it is gone.
   */
  const parts = [
    addressBlock,
    p(),
    p('Dear Sir,'),
    p('Please find the following Quotation for your kind consideration: -'),
    p(),
    // Heading5 => centred, bold, underlined. The letterhead overrides its
    // 11pt back to 12pt on the run, and so does this.
    p('Quotation ', { style: 'Heading5' }),
    p(),
    itemsTable,
    p(),
    p('Terms and Condition:', { bold: true }),
    p('1.    Payment Terms\t: {payment}'),
    p('2.    Delivery\t\t: {delivery}'),
    p('3.    Prices\t\t: {pricesTerm}'),
    p('4.    Warranty\t\t: {warranty}'),
    p(),
    p(),
    p('If you have any queries, please feel free to call us at 40668812/88'),
    p('Looking forward to an encouraging and early response.'),
    p('\t'),
    p('\tThanking You,'),
    p('\t\t'),
    p('Yours Truly,', { bold: true }),
    p('For Newtech Computer Services Pvt., Ltd.', { bold: true }),
    /**
     * The letterhead has two blank paragraphs here, for a wet signature. They
     * are dropped, and it is the one place this departs from it.
     *
     * The template is empty, so its whitespace costs nothing. Fill in five line
     * items and those two blanks push "Rakhi Gupte" onto a second page on its
     * own — worse than the letterhead, not truer to it. The quotation the desk
     * actually sent has the name hard against the company line, and that is the
     * better authority for a document with contents in it.
     */
    p('{signatory}   ', { bold: true }),
    p(),
  ]

  return `<w:body>${parts.join('')}${sectPr}</w:body>`
}

// --- assemble --------------------------------------------------------------

function main(): void {
  const zip = new PizZip(readFileSync(SOURCE))

  const original = zip.file('word/document.xml')?.asText()
  if (!original) throw new Error(`Could not read word/document.xml from ${SOURCE}`)

  const openTag = /<w:document[^>]*>/.exec(original)?.[0]
  if (!openTag) throw new Error('Could not find the <w:document> element')

  const sectPrMatch = /<w:sectPr[\s\S]*?<\/w:sectPr>/.exec(original)?.[0]
  if (!sectPrMatch) throw new Error('Could not find <w:sectPr>')

  // Keep the header/footer references and the page size. Replace only the
  // margins: the original zeros were there to let a floating text box do the
  // insetting, and there is no text box any more. Left and right stay at zero
  // so the 11382-twip header table is not squeezed and the logo does not move;
  // the body is indented instead.
  const sectPr = sectPrMatch.replace(
    /<w:pgMar[^>]*\/>/,
    '<w:pgMar w:top="2100" w:right="0" w:bottom="1100" w:left="0" ' +
      'w:header="0" w:footer="0" w:gutter="0"/>',
  )

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    openTag +
    buildBody(sectPr) +
    '</w:document>'

  zip.file('word/document.xml', documentXml)

  mkdirSync(path.dirname(TARGET), { recursive: true })
  writeFileSync(TARGET, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }))

  console.log(`Wrote ${path.relative(ROOT, TARGET)}`)
  console.log(`  body indent ${BODY_INDENT_LEFT} twips, width ${BODY_WIDTH} twips`)
  console.log(`  item columns ${ITEM_COLS.join(' + ')} = ${ITEM_COLS.reduce((a, b) => a + b, 0)}`)
  console.log('  header, footer, styles and media copied through untouched')
}

main()
