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
 *   word/styles.xml    Arial 12pt          byte-identical
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
 * Six columns now: §7 adds Make, which the original five-column table has no
 * room for. Taken out of the description, so the total is unchanged at 9464 and
 * the table still lines up with everything else on the page.
 *
 * Sr    Description  Make   Rate   Qty   Amount
 */
const ITEM_COLS = [562, 3874, 1200, 1276, 851, 1701]

// --- XML helpers -----------------------------------------------------------

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Arial 12pt — the letterhead's face. docDefaults is Times, so be explicit. */
function rPr(opts: { bold?: boolean; italic?: boolean } = {}): string {
  return (
    '<w:rPr>' +
    '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>' +
    (opts.bold ? '<w:b/><w:bCs/>' : '') +
    (opts.italic ? '<w:i/>' : '') +
    '<w:sz w:val="24"/><w:szCs w:val="24"/>' +
    '</w:rPr>'
  )
}

interface RunOpts {
  bold?: boolean
  italic?: boolean
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
      return `<w:r>${rPr(opts)}${lineIndex > 0 ? '<w:br/>' : ''}${inner}</w:r>`
    })
    .join('')
}

interface ParaOpts extends RunOpts {
  align?: 'left' | 'center' | 'right'
  /** Suppress the standard body indent — used inside table cells. */
  bare?: boolean
  spaceAfter?: number
  tabs?: number[]
}

function p(text = '', opts: ParaOpts = {}): string {
  const ind = opts.bare
    ? ''
    : `<w:ind w:left="${BODY_INDENT_LEFT}" w:right="${BODY_INDENT_RIGHT}"/>`
  const jc = opts.align && opts.align !== 'left' ? `<w:jc w:val="${opts.align}"/>` : ''
  const spacing = `<w:spacing w:after="${opts.spaceAfter ?? 0}" w:line="240" w:lineRule="auto"/>`
  const tabs = opts.tabs?.length
    ? `<w:tabs>${opts.tabs.map((pos) => `<w:tab w:val="left" w:pos="${pos}"/>`).join('')}</w:tabs>`
    : ''
  return `<w:p><w:pPr>${spacing}${ind}${tabs}${jc}</w:pPr>${runs(text, opts)}</w:p>`
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
  const [sr, desc, make, rate, qty, amount] = ITEM_COLS as [
    number, number, number, number, number, number,
  ]

  const addressBlock = tbl(
    HEADER_COLS,
    [
      tr(tc(c1, 'Ref: {ref}') + tc(c2, 'Date: {dateLong}')),
      tr(
        tc(c1, 'To:\n{customerName}\n{customerAddress}') +
          tc(c2, 'From:\nNewtech Computer Services Pvt. Ltd.\n6th Floor, Solaris-II, Opp L&T Gate-6,\nSaki Vihar Road, Powai,\nMumbai- 400072.'),
      ),
      tr(tc(c1, 'Contact Number: {contact}') + tc(c2, 'Email: {email}')),
      tr(tc(c1 + c2, 'Kind Attention: {attention}', { span: 2 })),
    ],
  )

  const itemsTable = tbl(ITEM_COLS, [
    // Header row.
    tr(
      tc(sr, 'Sr. No', { bold: true, align: 'center' }) +
        tc(desc, 'Product Name and Description', { bold: true }) +
        tc(make, 'Make', { bold: true }) +
        tc(rate, 'Rate\n(Rupees)', { bold: true, align: 'center' }) +
        tc(qty, 'Qty.', { bold: true, align: 'center' }) +
        tc(amount, 'Amount\n(Rupees)', { bold: true, align: 'center' }),
    ),
    // §8's loop. docxtemplater expands the whole row because the opening and
    // closing tags sit in the same one.
    tr(
      tc(sr, '{#items}{sr}', { align: 'center' }) +
        tc(desc, '{desc}') +
        tc(make, '{make}') +
        tc(rate, '{rate}', { align: 'right' }) +
        tc(qty, '{qty}', { align: 'center' }) +
        tc(amount, '{amount}{/items}', { align: 'right' }),
    ),
    tr(
      tc(sr, '') +
        tc(desc + make + rate + qty, 'Sub Total', { span: 4, bold: true }) +
        tc(amount, '{subTotal}', { align: 'right', bold: true }),
    ),
    // One row per tax row: IGST alone, or CGST and SGST (§7).
    tr(
      tc(sr, '') +
        tc(desc + make + rate + qty, '{#taxRows}{taxLabel}', { span: 4 }) +
        tc(amount, '{taxAmount}{/taxRows}', { align: 'right' }),
    ),
    tr(
      tc(sr, '') +
        tc(desc + make + rate + qty, 'Total Amount', { span: 4, bold: true }) +
        tc(amount, '{grandTotal}', { align: 'right', bold: true }),
    ),
  ])

  // Tab stops for the terms block, so the colons line up as they do today.
  const TERM_TABS = [BODY_INDENT_LEFT + 2200, BODY_INDENT_LEFT + 2400]

  const parts = [
    addressBlock,
    p(),
    p('Dear Sir,'),
    p('Please find the following Quotation for your kind consideration: -'),
    p(),
    p('Quotation', { bold: true, align: 'center' }),
    p(),
    itemsTable,
    p(),
    p('Amount in words: {amountWords}', { italic: true }),
    p(),
    p('Terms and Conditions:', { bold: true }),
    p('1.    Payment Terms\t: {payment}', { tabs: TERM_TABS }),
    p('2.    Delivery\t: {delivery}', { tabs: TERM_TABS }),
    p('3.    Prices\t: {pricesTerm}', { tabs: TERM_TABS }),
    p('4.    Validity\t: {validity}', { tabs: TERM_TABS }),
    p(),
    p('If you have any queries, please call us at 40668812/88.'),
    p('Looking forward to an encouraging and early response.'),
    p(),
    p('\tThanking You,', { tabs: [BODY_INDENT_LEFT + 3600] }),
    p('\tYours Truly,', { tabs: [BODY_INDENT_LEFT + 3600] }),
    p('For Newtech Computer Services Pvt., Ltd.'),
    p(),
    p(),
    p('{signatory}', { bold: true }),
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
