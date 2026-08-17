import { useRef, useState } from 'react'
import type { Quote } from '@shared/schema'
import { COMPANY } from '@shared/company'
import { amountInWords, computeTotals, formatPaise, pad2 } from '@shared/money'
import { formatDateLong, fromISODate } from '@shared/fy'
import { apiDownload, apiPost, useApi } from '../lib/api'
import Callout from '../components/Callout'
import ScreenHeader from '../components/ScreenHeader'

interface Props {
  quote: Quote
  onRevise: () => void
  onStartNew: () => void
}

type Health = { checks: Record<string, { ok: boolean; detail: string }> }

/**
 * Screen 4 — Document.
 *
 * §9: "a serif only inside the document preview so it reads as paper". This is
 * the one place in the application that is not the dense back-office sans.
 */
export default function Preview({ quote, onRevise, onStartNew }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'help' | 'problem'; text: string } | null>(null)
  const [status, setStatus] = useState(quote.status)
  const paperRef = useRef<HTMLDivElement>(null)

  const health = useApi<Health>('/api/health')
  const pdfReady = health.data?.checks.pdf?.ok ?? false
  const pdfDetail = health.data?.checks.pdf?.detail ?? ''

  const totals = computeTotals(quote.items, quote.tax.mode, quote.tax.rate)

  async function download(kind: 'docx' | 'pdf') {
    setBusy(kind)
    setMessage(null)
    try {
      await apiDownload(`/api/render/${kind}`, { quoteId: quote.id })
    } catch (err) {
      setMessage({ tone: 'problem', text: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  async function copyForWord() {
    const html = paperRef.current?.innerHTML ?? ''
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([paperRef.current?.innerText ?? ''], { type: 'text/plain' }),
        }),
      ])
      setMessage({ tone: 'help', text: 'Copied. Paste straight into Word.' })
    } catch {
      setMessage({
        tone: 'problem',
        text: 'Could not reach the clipboard — use Download Word instead.',
      })
    }
  }

  async function setQuoteStatus(next: Quote['status']) {
    setStatus(next)
    await apiPost(`/api/quotes/${quote.id}/status`, { status: next }).catch(() => {
      setMessage({ tone: 'problem', text: 'Could not save that status.' })
    })
  }

  return (
    <div className="max-w-5xl">
      <ScreenHeader
        step={4}
        title="Document"
        purpose="Saved. This is what the customer will see — download it as Word to edit before sending, or as PDF to send as-is."
        right={
          <span className="ref text-[13px] no-print">
            {quote.ref}
            {quote.revision > 0 && ` (Rev ${quote.revision})`}
          </span>
        }
      />

      {/* The on-screen render. Serif, cream, sized to A4 proportions. */}
      <div ref={paperRef} className="panel mx-auto max-w-[820px] p-10 font-serif text-[13.5px] leading-relaxed">
        <table className="mb-4 w-full border border-ink/30 text-[13px]">
          <tbody>
            <tr>
              <td className="w-1/2 border border-ink/30 p-2 align-top">Ref: {quote.ref}{quote.revision > 0 && ` (Rev ${quote.revision})`}</td>
              <td className="border border-ink/30 p-2 align-top">
                Date: {formatDateLong(fromISODate(quote.date))}
              </td>
            </tr>
            <tr>
              <td className="border border-ink/30 p-2 align-top">
                To:
                <br />
                {quote.customer.name}
                {quote.customer.address.split('\n').map((l) => (
                  <span key={l}>
                    <br />
                    {l}
                  </span>
                ))}
              </td>
              <td className="border border-ink/30 p-2 align-top">
                From:
                <br />
                {COMPANY.name}
                {COMPANY.addressLines.map((l) => (
                  <span key={l}>
                    <br />
                    {l}
                  </span>
                ))}
              </td>
            </tr>
            <tr>
              <td className="border border-ink/30 p-2">Contact Number: {quote.contact}</td>
              <td className="border border-ink/30 p-2">Email: {quote.email}</td>
            </tr>
            <tr>
              <td className="border border-ink/30 p-2" colSpan={2}>
                Kind Attention: {quote.customer.attention}
              </td>
            </tr>
          </tbody>
        </table>

        <p>Dear Sir,</p>
        <p>Please find the following Quotation for your kind consideration: -</p>
        <p className="my-3 text-center font-bold">Quotation</p>

        <table className="w-full border border-ink/30 text-[12.5px]">
          <thead>
            <tr className="font-bold">
              <th className="border border-ink/30 p-1.5">Sr. No</th>
              <th className="border border-ink/30 p-1.5 text-left">Product Name and Description</th>
              <th className="border border-ink/30 p-1.5 text-left">Make</th>
              <th className="border border-ink/30 p-1.5">Rate (Rupees)</th>
              <th className="border border-ink/30 p-1.5">Qty.</th>
              <th className="border border-ink/30 p-1.5">Amount (Rupees)</th>
            </tr>
          </thead>
          <tbody>
            {quote.items.map((item, i) => (
              <tr key={i}>
                <td className="border border-ink/30 p-1.5 text-center">{pad2(i + 1)}</td>
                <td className="border border-ink/30 p-1.5">{item.desc}</td>
                <td className="border border-ink/30 p-1.5">{item.make}</td>
                <td className="border border-ink/30 p-1.5 text-right">{formatPaise(item.rate)}</td>
                <td className="border border-ink/30 p-1.5 text-center">{pad2(item.qty)}</td>
                <td className="border border-ink/30 p-1.5 text-right">
                  {formatPaise(item.qty * item.rate)}
                </td>
              </tr>
            ))}
            <tr>
              <td className="border border-ink/30 p-1.5" />
              <td className="border border-ink/30 p-1.5 font-bold" colSpan={4}>
                Sub Total
              </td>
              <td className="border border-ink/30 p-1.5 text-right font-bold">
                {formatPaise(totals.sub)}
              </td>
            </tr>
            {totals.taxRows.map((row) => (
              <tr key={row.label}>
                <td className="border border-ink/30 p-1.5" />
                <td className="border border-ink/30 p-1.5" colSpan={4}>
                  {row.label}
                </td>
                <td className="border border-ink/30 p-1.5 text-right">{formatPaise(row.paise)}</td>
              </tr>
            ))}
            <tr>
              <td className="border border-ink/30 p-1.5" />
              <td className="border border-ink/30 p-1.5 font-bold" colSpan={4}>
                Total Amount
              </td>
              <td className="border border-ink/30 p-1.5 text-right font-bold">
                {formatPaise(totals.total)}
              </td>
            </tr>
          </tbody>
        </table>

        <p className="mt-3 italic">Amount in words: {amountInWords(totals.total)}</p>

        <p className="mt-4 font-bold">Terms and Conditions:</p>
        <p>1.&nbsp;&nbsp;&nbsp;&nbsp;Payment Terms&nbsp;&nbsp;: {quote.terms.payment}</p>
        <p>2.&nbsp;&nbsp;&nbsp;&nbsp;Delivery&nbsp;&nbsp;: {quote.terms.delivery}</p>
        <p>3.&nbsp;&nbsp;&nbsp;&nbsp;Prices&nbsp;&nbsp;: {quote.terms.prices}</p>
        <p>4.&nbsp;&nbsp;&nbsp;&nbsp;Validity&nbsp;&nbsp;: {quote.terms.validity}</p>

        <p className="mt-4">
          If you have any queries, please call us at {COMPANY.queriesNumbers}.
        </p>
        <p>Looking forward to an encouraging and early response.</p>
        <p className="mt-4">Thanking You,</p>
        <p>Yours Truly,</p>
        <p>{COMPANY.closingFor}</p>
        <p className="mt-6 font-bold">{quote.signatory}</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 no-print">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => download('docx')}
          disabled={busy !== null}
          title="The editable Word file, on the letterhead"
        >
          {busy === 'docx' ? 'Building…' : 'Download Word'}
        </button>

        <button
          type="button"
          className="btn"
          onClick={() => download('pdf')}
          disabled={busy !== null || !pdfReady}
          title={
            pdfReady
              ? 'Converted from the very same Word file, so the two cannot disagree'
              : pdfDetail
          }
        >
          {busy === 'pdf' ? 'Converting…' : 'Download PDF'}
        </button>

        <button
          type="button"
          className="btn"
          onClick={copyForWord}
          disabled={busy !== null}
          title="Puts it on the clipboard to paste into an email or an open document"
        >
          Copy
        </button>

        <span className="grow" />

        <span className="label">Status</span>
        <select
          value={status}
          onChange={(e) => setQuoteStatus(e.target.value as Quote['status'])}
          className="border border-rule bg-paper-raised px-2 py-1 text-[13px]"
        >
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </select>

        <button type="button" className="btn" onClick={onRevise}>
          Revise
        </button>
        <button type="button" className="btn" onClick={onStartNew}>
          New quotation
        </button>
      </div>

      {!pdfReady && health.data && (
        <Callout className="mt-3 no-print" label="PDF is off">
          {pdfDetail} The Word download is unaffected — open it and save as PDF from there in the
          meantime.
        </Callout>
      )}

      {message && (
        <Callout
          tone={message.tone}
          label={message.tone === 'problem' ? 'Problem' : undefined}
          className="mt-3 no-print"
        >
          {message.text}
        </Callout>
      )}
    </div>
  )
}
