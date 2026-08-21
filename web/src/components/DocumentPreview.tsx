import { Fragment } from 'react'
import { COMPANY, gstinLine } from '@shared/company'
import { splitDescription } from '@shared/description'
import { computeTotals, formatPaise, pad2 } from '@shared/money'
import { ORDINAL_SUFFIX_RE, formatDateParts, fromISODate } from '@shared/fy'

export interface DocumentData {
  /** Empty until the quotation is saved and takes a number. */
  ref: string
  revision: number
  /** YYYY-MM-DD */
  date: string
  /** `gstin` optional exactly as the schema has it: a customer can have none on file. */
  customer: { name: string; address: string; attention: string; gstin?: string }
  contact: string
  email: string
  signatory: string
  items: Array<{ desc: string; qty: number; rate: number }>
  tax: { mode: 'IGST' | 'CGST+SGST'; rate: number }
  /**
   * `warranty` is the fifth term, printed on every document like the four
   * beside it. Required rather than optional so the editor cannot quietly stop
   * passing it and leave the preview showing a document the download does not
   * match.
   */
  terms: {
    payment: string
    delivery: string
    prices: string
    validity: string
    warranty: string
  }
}

interface Props {
  data: DocumentData
  /** Shown in place of the reference before the quotation has been saved. */
  pendingRef?: string
}

/**
 * Column widths as percentages of the real table widths, so the preview has the
 * same proportions as the document rather than proportions that merely look
 * about right. Straight from build-template.ts.
 */
const HEADER_W = [5098, 4536] // the 142-twip spacer folds into the right-hand cell
const ITEM_W = [562, 5529, 1417, 709, 1559]
const pct = (widths: number[], i: number) =>
  `${((widths[i]! / widths.reduce((a, b) => a + b, 0)) * 100).toFixed(2)}%`

/**
 * The terms block sits in its own text box in the document, 55.5pt from the
 * page edge where the body's is at 33.75pt — so it steps in by 21.75pt of a
 * 524.15pt body. Its colons all land 109.3pt into a 498.75pt block.
 *
 * Held as percentages so the proportions survive the preview being narrower
 * than a page.
 */
const TERMS_STEP = `${((21.75 / 524.15) * 100).toFixed(2)}%`
const TERMS_COLON = `${((109.3 / 498.75) * 100).toFixed(2)}%`

const CELL = 'border border-ink/30 p-1 align-top'
/** The document fills the whole address block with a 5% grey. */
const SHADED = `${CELL} bg-ink/[0.04]`

/**
 * Raise the suffix of any ordinal, so "6th Floor" reads "6^th Floor" as it does
 * on the letterhead. Same regex the template builder uses, from shared/fy.ts.
 */
function withOrdinals(text: string) {
  const out: Array<string | JSX.Element> = []
  let cursor = 0
  for (const match of text.matchAll(ORDINAL_SUFFIX_RE)) {
    out.push(text.slice(cursor, match.index))
    out.push(<sup key={match.index}>{match[0]}</sup>)
    cursor = match.index + match[0].length
  }
  out.push(text.slice(cursor))
  return out
}

/**
 * The quotation as it will read on the letterhead, rendered from whatever is in
 * the form right now.
 *
 * Takes plain data rather than a saved Quote, so it can show a draft that has
 * no reference number yet — the whole point of putting it beside the editor is
 * that you see the effect of a change while you are making it.
 *
 * §9: "a serif only inside the document preview so it reads as paper." This is
 * the one place in the application that is not the dense back-office sans.
 *
 * Every line of it mirrors server/scripts/build-template.ts, paragraph for
 * paragraph and cell for cell — the column proportions, which lines are bold,
 * which are centred, and the blank line inside each item row. Change one and
 * change the other.
 *
 * It is still a representation, not a rendering: the Word file and the PDF come
 * from the real letterhead. This shows content, order and emphasis.
 */
export default function DocumentPreview({ data, pendingRef }: Props) {
  const totals = computeTotals(data.items, data.tax.mode, data.tax.rate)
  const reference = data.ref || pendingRef || '—'
  const date = formatDateParts(fromISODate(data.date))
  // The serial-number column merges downward from the last line item, so one
  // unbroken cell runs past Sub Total, the tax rows and Total.
  const totalsRows = 2 + totals.taxRows.length
  const lastItem = data.items.length - 1
  // Label and value in one string, from the same helper the document renders
  // from, so neither side can print a GSTIN label with nothing after it. Where
  // the document degrades to an empty paragraph the preview shows nothing,
  // which is how the address lines above already treat their blanks.
  const customerGstin = gstinLine(data.customer.gstin)
  const companyGstin = gstinLine(COMPANY.gstin)
  // All five, always — the document prints term 5 whatever it holds, so a row
  // hidden here would be a line the customer's copy has and this one has not.
  // Trimmed for the same reason buildRenderModel trims: "   " would otherwise
  // print as a value.
  const numberedTerms: Array<[string, string, string]> = [
    ['1.', 'Payment Terms', data.terms.payment],
    ['2.', 'Delivery', data.terms.delivery],
    ['3.', 'Prices', data.terms.prices],
    ['4.', 'Validity', data.terms.validity],
    ['5.', 'Warranty', data.terms.warranty.trim()],
  ]

  return (
    <div className="panel bg-paper-raised p-6 font-serif text-[12px] leading-relaxed">
      <table className="mb-3 w-full table-fixed border border-ink/30">
        <tbody>
          {/* Bold, from the document's Heading4 style, and the ordinal in the
              date is raised. */}
          <tr>
            <td className={`${SHADED} font-bold`} colSpan={2}>
              Ref: {reference}
              {data.revision > 0 && ` (Rev ${data.revision})`}
              <br />
              Date: {date.day}
              <sup>{date.ordinal}</sup>
              {date.rest}
            </td>
          </tr>
          <tr>
            <td className={SHADED} style={{ width: pct(HEADER_W, 0) }}>
              <span className="font-bold">To: </span>
              <br />
              <span className="font-bold">
                {data.customer.name || <span className="font-normal text-ink-faint">(customer)</span>}
              </span>
              {data.customer.address
                .split('\n')
                .filter(Boolean)
                .map((l) => (
                  <span key={l}>
                    <br />
                    {l}
                  </span>
                ))}
              {customerGstin && (
                <span>
                  <br />
                  {customerGstin}
                </span>
              )}
            </td>
            <td className={SHADED} style={{ width: pct(HEADER_W, 1) }}>
              <span className="font-bold">From: </span>
              <br />
              <span className="font-bold">{COMPANY.name}</span>
              {COMPANY.addressLines.map((l) => (
                <span key={l}>
                  <br />
                  {withOrdinals(l)}
                </span>
              ))}
              {companyGstin && (
                <span>
                  <br />
                  {companyGstin}
                </span>
              )}
            </td>
          </tr>
          <tr>
            <td className={SHADED}>Contact Number:{data.contact}</td>
            <td className={SHADED}>Email: {data.email}</td>
          </tr>
          <tr>
            <td className={`${SHADED} text-center font-bold`} colSpan={2}>
              Kind Attention: {data.customer.attention}
            </td>
          </tr>
        </tbody>
      </table>

      <p>Dear Sir,</p>
      <p>Please find the following Proforma Invoice for your kind consideration: -</p>
      {/* Heading5 in the letterhead: centred, bold, underlined. */}
      <p className="my-2 text-center font-bold underline">Proforma Invoice</p>

      <table className="w-full table-fixed border border-ink/30 text-[11.5px]">
        <thead>
          <tr className="font-bold">
            <th className={`${CELL} text-center`} style={{ width: pct(ITEM_W, 0) }}>
              Sr. No
            </th>
            <th className={`${CELL} text-center`} style={{ width: pct(ITEM_W, 1) }}>
              Product Name and Description
            </th>
            <th className={`${CELL} text-center`} style={{ width: pct(ITEM_W, 2) }}>
              Rate (Rupees)
            </th>
            <th className={`${CELL} text-center`} style={{ width: pct(ITEM_W, 3) }}>
              Qty.
            </th>
            <th className={`${CELL} text-center`} style={{ width: pct(ITEM_W, 4) }}>
              Amount
              <br />
              (Rupees)
            </th>
          </tr>
        </thead>
        <tbody>
          {data.items.length === 0 && (
            <tr>
              <td className={`${CELL} p-2 text-center text-ink-faint`} colSpan={5}>
                No lines yet
              </td>
            </tr>
          )}
          {/* Each cell opens with a blank line and the description carries a
              second one between the name and the specification. That spacing is
              the document's, and it is what lines the figures up with the
              product name instead of the line above it. */}
          {data.items.map((item, i) => {
            const { descName, descSpec } = splitDescription(item.desc)
            return (
              <tr key={i}>
                <td className={CELL} rowSpan={i === lastItem ? totalsRows + 1 : 1}>
                  <br />
                  {pad2(i + 1)}
                </td>
                <td className={CELL}>
                  <br />
                  <span className="font-bold underline">{descName}</span>
                  {descSpec && (
                    <>
                      <br />
                      <br />
                      <span className="whitespace-pre-line">{descSpec}</span>
                    </>
                  )}
                </td>
                <td className={`${CELL} text-center`}>
                  <br />
                  {formatPaise(item.rate)}
                </td>
                <td className={`${CELL} text-center`}>
                  <br />
                  {pad2(item.qty)}
                </td>
                <td className={`${CELL} text-center`}>
                  <br />
                  {formatPaise(item.qty * item.rate)}
                </td>
              </tr>
            )
          })}
          {/* Five cells, not a colSpan: the label sits under the description
              column and the figure under the amount column, with the rate and
              quantity columns left empty. Both are centred. */}
          {/* No cell of their own: the serial column above spans down over
              them, which is what leaves the totals block with no rule across
              its left edge. Only an empty quotation has nothing to span from. */}
          <tr>
            {data.items.length === 0 && <td className={CELL} />}
            <td className={`${CELL} text-center`}>Sub Total</td>
            <td className={CELL} />
            <td className={CELL} />
            <td className={`${CELL} text-center`}>{formatPaise(totals.sub)}</td>
          </tr>
          {totals.taxRows.map((row) => (
            <tr key={row.label}>
              {data.items.length === 0 && <td className={CELL} />}
              <td className={`${CELL} text-center`}>{row.label}</td>
              <td className={CELL} />
              <td className={CELL} />
              <td className={`${CELL} text-center`}>{formatPaise(row.paise)}</td>
            </tr>
          ))}
          <tr>
            {data.items.length === 0 && <td className={CELL} />}
            <td className={`${CELL} text-center font-bold`}>Total Amount</td>
            <td className={CELL} />
            <td className={CELL} />
            <td className={`${CELL} text-center font-bold`}>{formatPaise(totals.total)}</td>
          </tr>
        </tbody>
      </table>

      {/* Everything from here down is stepped in, because in the document it
          lives in a second text box set further from the edge than the one
          above it. */}
      <div className="mt-3" style={{ paddingLeft: TERMS_STEP }}>
        <p className="font-bold">Terms and Conditions:</p>
        {/* A two-column grid rather than counted spaces, so every colon lands
            in one column exactly as the template's tab stop puts them. */}
        <div className="grid" style={{ gridTemplateColumns: `${TERMS_COLON} 1fr` }}>
          {numberedTerms.map(([n, label, value]) => (
            <Fragment key={n}>
              <span>
                {n}&nbsp;&nbsp;&nbsp;&nbsp;{label}
              </span>
              <span>: {value}</span>
            </Fragment>
          ))}
        </div>

        <p className="mt-3">
          If you have any queries, please feel free to call us at {COMPANY.queriesNumbers}
        </p>
        <p>Looking forward to an encouraging and early response.</p>
        <p className="mt-3">Thanking you,</p>
        <p className="mt-4 font-bold">Yours Truly,</p>
        <p className="font-bold">{COMPANY.closingFor}</p>
        {/* Three blank lines, the room left for a wet signature. */}
        <p className="mt-12 font-bold">{data.signatory}</p>
      </div>
    </div>
  )
}
