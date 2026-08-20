import { COMPANY } from '@shared/company'
import { computeTotals, formatPaise, pad2 } from '@shared/money'
import { formatDateLong, fromISODate } from '@shared/fy'

export interface DocumentData {
  /** Empty until the quotation is saved and takes a number. */
  ref: string
  revision: number
  /** YYYY-MM-DD */
  date: string
  customer: { name: string; address: string; attention: string }
  contact: string
  email: string
  signatory: string
  items: Array<{ desc: string; qty: number; rate: number }>
  tax: { mode: 'IGST' | 'CGST+SGST'; rate: number }
  /** The letterhead's fourth term is Warranty. */
  terms: { payment: string; delivery: string; prices: string; validity: string }
}

interface Props {
  data: DocumentData
  /** Shown in place of the reference before the quotation has been saved. */
  pendingRef?: string
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
 * paragraph, so what is on screen and what downloads say the same thing. Change
 * one and change the other.
 *
 * It is still a representation, not a rendering: the Word file and the PDF come
 * from the real letterhead. This shows content and order.
 */
export default function DocumentPreview({ data, pendingRef }: Props) {
  const totals = computeTotals(data.items, data.tax.mode, data.tax.rate)
  const reference = data.ref || pendingRef || '—'

  return (
    <div className="panel bg-paper-raised p-6 font-serif text-[12px] leading-relaxed">
      <table className="mb-3 w-full border border-ink/30">
        <tbody>
          <tr>
            <td className="border border-ink/30 p-1.5 font-bold" colSpan={2}>
              Ref: {reference}
              {data.revision > 0 && ` (Rev ${data.revision})`}
              <br />
              Date: {formatDateLong(fromISODate(data.date))}
            </td>
          </tr>
          <tr>
            <td className="w-1/2 border border-ink/30 p-1.5 align-top">
              <span className="font-bold">To: </span>
              <br />
              {data.customer.name || <span className="text-ink-faint">(customer)</span>}
              {data.customer.address
                .split('\n')
                .filter(Boolean)
                .map((l) => (
                  <span key={l}>
                    <br />
                    {l}
                  </span>
                ))}
            </td>
            <td className="border border-ink/30 p-1.5 align-top">
              From:
              <br />
              <span className="font-bold">{COMPANY.name}</span>
              {COMPANY.addressLines.map((l) => (
                <span key={l}>
                  <br />
                  {l}
                </span>
              ))}
            </td>
          </tr>
          <tr>
            <td className="border border-ink/30 p-1.5">Contact Number: {data.contact}</td>
            <td className="border border-ink/30 p-1.5">Email: {data.email}</td>
          </tr>
          <tr>
            <td className="border border-ink/30 p-1.5 text-center font-bold" colSpan={2}>
              Kind Attention: {data.customer.attention}
            </td>
          </tr>
        </tbody>
      </table>

      <p>Dear Sir,</p>
      <p>Please find the following Quotation for your kind consideration: -</p>
      {/* Heading5 in the letterhead: centred, bold, underlined. */}
      <p className="my-2 text-center font-bold underline">Quotation</p>

      <table className="w-full border border-ink/30 text-[11.5px]">
        <thead>
          <tr className="font-bold">
            <th className="w-[6%] border border-ink/30 p-1">Sr. No</th>
            <th className="w-[54%] border border-ink/30 p-1">Product Name and Description</th>
            <th className="w-[13%] border border-ink/30 p-1">Rate (Rupees)</th>
            <th className="w-[9%] border border-ink/30 p-1">Qty.</th>
            <th className="w-[18%] border border-ink/30 p-1">
              Amount
              <br />
              (Rupees)
            </th>
          </tr>
        </thead>
        <tbody>
          {data.items.length === 0 && (
            <tr>
              <td className="border border-ink/30 p-2 text-center text-ink-faint" colSpan={5}>
                No lines yet
              </td>
            </tr>
          )}
          {data.items.map((item, i) => (
            <tr key={i}>
              <td className="border border-ink/30 p-1 text-center align-top">{pad2(i + 1)}</td>
              <td className="whitespace-pre-line border border-ink/30 p-1 align-top">
                {item.desc}
              </td>
              <td className="border border-ink/30 p-1 text-right align-top">
                {formatPaise(item.rate)}
              </td>
              <td className="border border-ink/30 p-1 text-center align-top">{pad2(item.qty)}</td>
              <td className="border border-ink/30 p-1 text-right align-top">
                {formatPaise(item.qty * item.rate)}
              </td>
            </tr>
          ))}
          <tr>
            <td className="border border-ink/30 p-1" />
            <td className="border border-ink/30 p-1 text-center" colSpan={3}>
              Sub Total
            </td>
            <td className="border border-ink/30 p-1 text-right font-bold">
              {formatPaise(totals.sub)}
            </td>
          </tr>
          {totals.taxRows.map((row) => (
            <tr key={row.label}>
              <td className="border border-ink/30 p-1" />
              <td className="border border-ink/30 p-1 text-center" colSpan={3}>
                {row.label}
              </td>
              <td className="border border-ink/30 p-1 text-right">{formatPaise(row.paise)}</td>
            </tr>
          ))}
          <tr>
            <td className="border border-ink/30 p-1" />
            <td className="border border-ink/30 p-1 text-center font-bold" colSpan={3}>
              Total Amount
            </td>
            <td className="border border-ink/30 p-1 text-right font-bold">
              {formatPaise(totals.total)}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="mt-3 font-bold">Terms and Condition:</p>
      <p>1.&nbsp;&nbsp;&nbsp;&nbsp;Payment Terms&nbsp;&nbsp;&nbsp;&nbsp;: {data.terms.payment}</p>
      <p>2.&nbsp;&nbsp;&nbsp;&nbsp;Delivery&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: {data.terms.delivery}</p>
      <p>3.&nbsp;&nbsp;&nbsp;&nbsp;Prices&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: {data.terms.prices}</p>
      <p>4.&nbsp;&nbsp;&nbsp;&nbsp;Warranty&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: {data.terms.validity}</p>

      <p className="mt-3">
        If you have any queries, please feel free to call us at {COMPANY.queriesNumbers}
      </p>
      <p>Looking forward to an encouraging and early response.</p>
      <p className="mt-3">&nbsp;&nbsp;&nbsp;&nbsp;Thanking You,</p>
      <p className="mt-2 font-bold">Yours Truly,</p>
      <p className="font-bold">{COMPANY.closingFor}</p>
      <p className="mt-4 font-bold">{data.signatory}</p>
    </div>
  )
}
