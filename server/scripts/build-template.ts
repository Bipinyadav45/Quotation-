/**
 * Rebuilds server/templates/quotation-template.docx from the letterhead —
 * CORRECTION 1.
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
 *   word/header1.xml   the logo             byte-identical
 *   word/footer1.xml   address + CIN rule   byte-identical
 *   word/styles.xml    12pt Times New Roman byte-identical
 *   word/media/*       the logo image       byte-identical
 *   w:sectPr           page size, header/footer references
 *
 * WHERE THE LAYOUT COMES FROM. Every measurement below was read out of the
 * quotation the desk supplied as definitive — a real, sent quotation with
 * contents in it, not the blank letterhead. Those two disagree, and where they
 * do the sent one wins: it is the document the customer actually receives.
 *
 * GEOMETRY. The original page has NO margins (`w:pgMar` is all zeros) because
 * the text box supplied the inset: it sat at 33.75pt from the left and was
 * 524.15pt wide. Setting real left/right page margins would be the obvious move
 * and is WRONG — the header table is 11382 twips wide, sized for a zero-margin
 * page, so margins would push the logo out of place. Instead the left/right
 * margins stay at zero and the body content is indented by hand, which
 * reproduces the original text position and leaves the header and footer
 * exactly as they were.
 */

import PizZip from 'pizzip'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ROOT } from '../src/config.js'
import { COMPANY } from '@shared/company.js'
import { ORDINAL_SUFFIX_RE } from '@shared/fy.js'

const SOURCE = path.resolve(ROOT, 'Quotation -- Format.docx')
const TARGET = path.resolve(ROOT, 'server', 'templates', 'quotation-template.docx')

// --- geometry, all in twips (1/20 pt) --------------------------------------
const BODY_INDENT_LEFT = 819 // 33.75pt text-box offset + its 0.1" internal inset
const BODY_WIDTH = 9776 // the width the item table actually is
const PAGE_WIDTH = 11909 // A4
const BODY_INDENT_RIGHT = PAGE_WIDTH - BODY_INDENT_LEFT - BODY_WIDTH

/**
 * The terms and the closing sit further in than everything above them, because
 * in the original they are a SECOND text box — at 55.5pt where the main one is
 * at 33.75pt, and 498.75pt wide where it is 524.15pt.
 *
 * There are no text boxes here any more, so the offset has to be applied as a
 * paragraph indent. Miss it and the terms line up under the item table instead
 * of stepping in from it, which is the difference between the two halves of the
 * page looking deliberate and looking misaligned.
 */
const TERMS_INDENT_LEFT = 1254 // 55.5pt + the 0.1" internal inset
const TERMS_INDENT_RIGHT = PAGE_WIDTH - TERMS_INDENT_LEFT - 9975 // 498.75pt wide

/**
 * The address block is THREE columns, not two: 5098 + 142 + 4394 = 9634.
 *
 * The 142-twip middle column is a spacer, and it is there because the rows
 * split at different points — To/From at 5098, Contact/Email at 5240. Two
 * columns cannot express that; three can, with each row spanning what it needs.
 */
const HEADER_COLS = [5098, 142, 4394]

/** The item table: five columns totalling 9776. */
const ITEM_COLS = [562, 5529, 1417, 709, 1559]

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
function rPr(
  opts: { bold?: boolean; italic?: boolean; underline?: boolean; superscript?: boolean } = {},
): string {
  return (
    '<w:rPr>' +
    (opts.bold ? '<w:b/><w:bCs/>' : '') +
    (opts.italic ? '<w:i/>' : '') +
    (opts.underline ? '<w:u w:val="single"/>' : '') +
    (opts.superscript ? '<w:vertAlign w:val="superscript"/>' : '') +
    '<w:sz w:val="24"/><w:szCs w:val="24"/>' +
    '</w:rPr>'
  )
}

interface RunOpts {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  superscript?: boolean
  /**
   * Raise the suffix of any ordinal in the text — "6th Floor" becomes
   * "6^th Floor", which is how the letterhead has it.
   *
   * Only useful on STATIC text. A docxtemplater tag is one run, and the value
   * substituted into it inherits that run's formatting whole, so an ordinal
   * arriving through a tag has to be split before it gets here — which is what
   * formatDateParts() in shared/fy.ts is for.
   */
  ordinals?: boolean
  /**
   * Bold only these lines of a multi-line run. Kept for callers that build a
   * whole block from one string.
   */
  boldLines?: number[]
}

/** One run of text — or several, when an ordinal inside it has to be raised. */
function textRuns(text: string, opts: RunOpts, leading = ''): string {
  const t = (s: string) => `<w:t xml:space="preserve">${esc(s)}</w:t>`
  const matches = opts.ordinals ? [...text.matchAll(ORDINAL_SUFFIX_RE)] : []

  if (matches.length === 0) return `<w:r>${rPr(opts)}${leading}${t(text)}</w:r>`

  const out: string[] = []
  let cursor = 0
  let prefix = leading

  for (const match of matches) {
    const before = text.slice(cursor, match.index)
    if (before) out.push(`<w:r>${rPr(opts)}${prefix}${t(before)}</w:r>`)
    else if (prefix) out.push(`<w:r>${rPr(opts)}${prefix}</w:r>`)
    prefix = ''
    out.push(`<w:r>${rPr({ ...opts, superscript: true })}${t(match[0])}</w:r>`)
    cursor = match.index + match[0].length
  }

  const tail = text.slice(cursor)
  if (tail) out.push(`<w:r>${rPr(opts)}${t(tail)}</w:r>`)
  return out.join('')
}

/** Text with \n turned into real line breaks and \t into tabs. */
function runs(text: string, opts: RunOpts = {}): string {
  if (text === '') return ''
  return text
    .split('\n')
    .map((lineText, lineIndex) => {
      const bold = opts.bold || opts.boldLines?.includes(lineIndex) === true
      const lineOpts = { ...opts, bold }
      const br = lineIndex > 0 ? '<w:br/>' : ''

      // A tab is an element rather than a character, so text and tabs alternate
      // as separate runs within the line.
      return lineText
        .split('\t')
        .map((part, i) => {
          const leading = (i === 0 ? br : '') + (i > 0 ? '<w:tab/>' : '')
          if (part === '') return leading ? `<w:r>${rPr(lineOpts)}${leading}</w:r>` : ''
          return textRuns(part, lineOpts, leading)
        })
        .join('')
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
  /** Override the body indent, for the terms block's deeper one. */
  indent?: { left: number; right: number }
  spaceAfter?: number
  tabs?: number[]
}

/** The terms and everything below them, stepped in from the item table. */
const TERMS: ParaOpts = { indent: { left: TERMS_INDENT_LEFT, right: TERMS_INDENT_RIGHT } }

/**
 * Where the colon lands on all four numbered terms — measured off the original,
 * where every one of them sits 172pt from the left edge of the page.
 *
 * The original gets there by accident: three of the lines tab to it and the
 * fourth pads with spaces until it happens to line up at that exact indent, in
 * that exact font. An explicit stop reaches the same column on purpose, and it
 * stays there if a term is ever renamed to a word of a different length.
 */
const TERM_COLON_TAB = 3413
const TERMS_NUMBERED: ParaOpts = { ...TERMS, tabs: [TERM_COLON_TAB] }

function p(text = '', opts: ParaOpts = {}): string {
  const style = opts.style ? `<w:pStyle w:val="${opts.style}"/>` : ''
  const indent = opts.indent ?? { left: BODY_INDENT_LEFT, right: BODY_INDENT_RIGHT }
  const ind = opts.bare ? '' : `<w:ind w:left="${indent.left}" w:right="${indent.right}"/>`
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
  /** `w:shd` fill pattern, e.g. "pct5". */
  shading?: string
}

/** A paragraph as it appears inside a table cell — no body indent. */
function cp(text = '', opts: CellOpts = {}): string {
  return p(text, { ...opts, bare: true })
}

/** The 5% grey the whole address block is filled with. */
const HEADER_SHADING = 'pct5'

interface StructuralCellOpts {
  span?: number
  /** `w:shd` fill pattern, e.g. "pct5". */
  shading?: string
  /**
   * Vertical merge. "restart" opens a merged run, "continue" extends the one
   * above it — which is how the serial-number column runs unbroken from the
   * last line item down past Sub Total, GST and Total, with no rules across it.
   */
  vMerge?: 'restart' | 'continue'
}

/**
 * A cell built from paragraph XML rather than from a string, so one cell can
 * mix weights. The address block needs it — "To:" and the customer name are
 * bold and the address beneath them is not — and so does a line item, where the
 * product name is bold and underlined above a plain specification.
 *
 * The child order here is not arbitrary: `w:tcPr` is a sequence, and Word
 * rejects a document whose properties are out of it. tcW, gridSpan, vMerge,
 * shd, vAlign.
 */
function cell(width: number, body: string, opts: StructuralCellOpts = {}): string {
  const span = opts.span ?? 1
  return (
    '<w:tc>' +
    `<w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>` +
    (span > 1 ? `<w:gridSpan w:val="${span}"/>` : '') +
    (opts.vMerge === 'restart'
      ? '<w:vMerge w:val="restart"/>'
      : opts.vMerge === 'continue'
        ? '<w:vMerge/>'
        : '') +
    (opts.shading ? `<w:shd w:val="${opts.shading}" w:color="auto" w:fill="auto"/>` : '') +
    '<w:vAlign w:val="top"/></w:tcPr>' +
    (body || cp()) +
    '</w:tc>'
  )
}

/** The common case: one paragraph, one formatting. */
function tc(width: number, text: string, opts: CellOpts = {}): string {
  return cell(width, cp(text, opts), { span: opts.span, shading: opts.shading })
}

/**
 * Minimum row heights, read off the definitive quotation. `hRule="atLeast"` is
 * a floor, not a ceiling, so a description that wraps grows its row instead of
 * being clipped.
 *
 * They are only a floor, because the table does not get its air from forced row
 * heights — it gets it from BLANK PARAGRAPHS inside the cells. That is how the
 * original does it, and it is the more robust of the two: a blank line stays
 * exactly one line however long the description runs, where a forced height
 * either wastes space on a short item or does nothing at all on a long one.
 */
export const ROW_HEIGHT = {
  headerRef: 542,
  headerTo: 1339,
  headerContact: 346,
  headerAttention: 262,
  itemHeader: 655,
  item: 300,
  subTotal: 480,
  tax: 441,
  total: 264,
} as const

function tr(cells: string, minHeight?: number): string {
  const height = minHeight
    ? `<w:trPr><w:trHeight w:hRule="atLeast" w:val="${minHeight}"/></w:trPr>`
    : ''
  return `<w:tr>${height}${cells}</w:tr>`
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
  const [h1, h2, h3] = HEADER_COLS as [number, number, number]
  const [sr, desc, rate, qty, amount] = ITEM_COLS as [number, number, number, number, number]

  // Ref and Date are two paragraphs in one cell spanning all three columns.
  // Rows 2 and 3 each span what they need, which is what the 142-twip spacer
  // column exists to allow.
  // Every cell in this table carries a 5% grey fill. It is subtle enough to be
  // easy to miss and it is the reason the block reads as a block.
  const shaded = (width: number, body: string, span?: number) =>
    cell(width, body, { span, shading: HEADER_SHADING })

  const addressBlock = tbl(HEADER_COLS, [
    tr(
      // Heading4 is where the bold comes from — the runs themselves carry none.
      // The style also sets 11pt, which the document overrides back to 12pt on
      // the run, and so does p().
      shaded(
        h1 + h2 + h3,
        cp('Ref: {ref}', { style: 'Heading4' }) +
          // Three tags, not one: the ordinal is raised, and Word can only raise
          // a whole run. shared/fy.ts hands the date over pre-split for exactly
          // this. Rendered, it reads "Date: 23^rd June 2026."
          `<w:p><w:pPr><w:pStyle w:val="Heading4"/>` +
          `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>` +
          runs('Date: {dateDay}', { bold: true }) +
          runs('{dateOrd}', { bold: true, superscript: true }) +
          runs('{dateRest}', { bold: true }) +
          `</w:p>`,
        3,
      ),
      ROW_HEIGHT.headerRef,
    ),
    tr(
      shaded(
        h1,
        cp('To: ', { bold: true }) +
          cp('{customerName}', { bold: true }) +
          cp('{customerAddress}') +
          // Label and value arrive as ONE string — see customerGstinLine in
          // server/src/lib/docx.ts. A literal "GSTIN: " label here would print
          // on every quotation whose customer has none.
          cp('{customerGstinLine}'),
      ) +
        shaded(
          h2 + h3,
          cp('From: ', { bold: true }) +
            // From COMPANY, not typed out here, so the letterhead block and
            // the on-screen preview cannot say different things.
            cp(COMPANY.name, { bold: true }) +
            // "6th Floor" — the letterhead raises that "th" too.
            COMPANY.addressLines.map((line) => cp(line, { ordinals: true })).join('') +
            // A tag rather than COMPANY.gstin baked in like the name above,
            // because the number is not known yet: filling it in then reaches
            // the document without this binary being regenerated.
            cp('{companyGstinLine}'),
          2,
        ),
      ROW_HEIGHT.headerTo,
    ),
    tr(
      shaded(h1 + h2, cp('Contact Number:{contact}'), 2) + shaded(h3, cp('Email: {email}')),
      ROW_HEIGHT.headerContact,
    ),
    tr(
      shaded(h1 + h2 + h3, cp('Kind Attention: {attention}', { bold: true, align: 'center' }), 3),
      ROW_HEIGHT.headerAttention,
    ),
  ])

  /**
   * Sub Total, GST and Total all have the same shape: the label under the
   * description column, the figure under the amount column, both CENTRED — not
   * right-aligned, which is what this used to do — and the three columns
   * between them empty.
   */
  const totalRow = (label: string, value: string, height: number, bold = false) =>
    tr(
      // Continues the serial-number column's vertical merge rather than opening
      // an empty bordered box, so no rule is drawn across it — which is what
      // makes the totals read as a block hanging off the table instead of three
      // more rows of it.
      cell(sr, '', { vMerge: 'continue' }) +
        tc(desc, label, { align: 'center', bold }) +
        tc(rate, '', { align: 'center' }) +
        tc(qty, '', { align: 'center' }) +
        tc(amount, value, { align: 'center', bold }),
      height,
    )

  const itemsTable = tbl(ITEM_COLS, [
    tr(
      tc(sr, 'Sr. No', { bold: true, align: 'center' }) +
        tc(desc, 'Product Name and Description', { bold: true, align: 'center' }) +
        tc(rate, 'Rate (Rupees)', { bold: true, align: 'center' }) +
        tc(qty, 'Qty.', { bold: true, align: 'center' }) +
        // Two paragraphs, not one wrapped line — that is why the header row is
        // as tall as it is.
        cell(
          amount,
          cp('Amount', { bold: true, align: 'center' }) +
            cp('(Rupees)', { bold: true, align: 'center' }),
        ),
      ROW_HEIGHT.itemHeader,
    ),
    /**
     * One row per item; docxtemplater expands the whole row, so the opening and
     * closing loop tags both live in it.
     *
     * Every cell opens with a blank paragraph, and the description carries a
     * second one between the name and the specification. That is the original's
     * spacing reproduced exactly, and it is why the serial number, rate,
     * quantity and amount line up with the product name instead of sitting a
     * line above it.
     *
     * The description arrives pre-split. It has to: the product name is bold and
     * underlined and the specification under it is not, and docxtemplater
     * substitutes text, not formatting — so a single {desc} tag could only ever
     * render the whole thing in one weight.
     */
    tr(
      // "restart" on every item row, so no two item rows merge into each other
      // — each opens its own run, and the three totals rows below continue the
      // last one.
      cell(sr, cp() + cp('{#items}{sr}'), { vMerge: 'restart' }) +
        cell(
          desc,
          cp() + cp('{descName}', { bold: true, underline: true }) + cp() + cp('{descSpec}'),
        ) +
        cell(rate, cp() + cp('{rate}', { align: 'center' })) +
        cell(qty, cp() + cp('{qty}', { align: 'center' })) +
        cell(amount, cp() + cp('{amount}{/items}', { align: 'center' })),
      ROW_HEIGHT.item,
    ),
    totalRow('Sub Total', '{subTotal}', ROW_HEIGHT.subTotal),
    // The tax row goes through totalRow like the other two. Built by hand it
    // kept a plain bordered cell in the serial column, which broke the vertical
    // merge running down from the last line item and put a stray rule across it.
    totalRow('{#taxRows}{taxLabel}', '{taxAmount}{/taxRows}', ROW_HEIGHT.tax),
    totalRow('Total Amount', '{grandTotal}', ROW_HEIGHT.total, true),
  ])

  /**
   * Paragraph for paragraph as the definitive quotation has it, blank lines
   * included. The tabs are the document's own; it relies on Word's default tab
   * stops, so no custom ones are set here either.
   *
   * Nothing has been added, and the one departure is noted where it happens.
   */
  const parts = [
    addressBlock,
    p(),
    p('Dear Sir,'),
    p('Please find the following Proforma Invoice for your kind consideration: -'),
    p(),
    // Heading5 => centred, bold, underlined. Those come from the style, not
    // from the paragraph.
    //
    // The document is a Proforma Invoice, not a quotation. The reference series
    // still reads NCS/<FY>/Quotes/<initials>/<seq> and the application is still
    // called the Quotation Desk -- those are an identifier and a workplace name,
    // and renaming either would break the numbering's continuity with every
    // document already sent.
    p('Proforma Invoice ', { style: 'Heading5' }),
    p(),
    itemsTable,
    p(),
    p('Terms and Conditions:', { ...TERMS, bold: true }),
    p('1.    Payment Terms\t: {payment}', TERMS_NUMBERED),
    p('2.    Delivery\t: {delivery}', TERMS_NUMBERED),
    p('3.    Prices\t: {pricesTerm}', TERMS_NUMBERED),
    /**
     * The original pads this one line with spaces instead of tabbing it, and at
     * its exact indent that happens to land the colon in the same column. Here
     * it tabs like the other three, which reaches the identical column without
     * depending on the coincidence.
     *
     * The original also says "Warranty" where this says "Validity" — the one
     * place the wording departs from the source document, on the desk's
     * explicit instruction, because Validity is what tells the customer how
     * long the price holds. Changing it back is this line and the matching
     * field name, nothing else.
     */
    p('4.    Validity\t: {validity}', TERMS_NUMBERED),
    p('', TERMS),
    p(
      `If you have any queries, please feel free to call us at ${COMPANY.queriesNumbers}`,
      TERMS,
    ),
    p('Looking forward to an encouraging and early response.', TERMS),
    // The closing, blank line for blank line as the original has it. "Thanking
    // you," carries no tab — it sits flush with the terms above it — and the
    // lone tabbed blank two lines down is the original's, not a stray.
    p('', TERMS),
    p('Thanking you,', TERMS),
    p('', TERMS),
    p('\t', TERMS),
    p('Yours Truly,', { ...TERMS, bold: true }),
    p(COMPANY.closingFor, { ...TERMS, bold: true }),
    // Three blank paragraphs, the space left for a wet signature.
    p('', TERMS),
    p('', TERMS),
    p('', TERMS),
    p('{signatory}', { ...TERMS, bold: true }),
    p('', TERMS),
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
  console.log(`  header columns ${HEADER_COLS.join(' + ')} = ${HEADER_COLS.reduce((a, b) => a + b, 0)}`)
  console.log(`  item columns ${ITEM_COLS.join(' + ')} = ${ITEM_COLS.reduce((a, b) => a + b, 0)}`)
  console.log('  header, footer, styles and media copied through untouched')
}

main()
