import { useState } from 'react'
import type { Quote, QuoteSummary } from '@shared/schema'
import { formatPaise } from '@shared/money'
import { formatDateLong, fromISODate } from '@shared/fy'
import { apiDownload, apiGet, useApi } from '../lib/api'

interface Props {
  onOpen: (quote: Quote) => void
  onClone: (quote: Quote) => void
}

const STATUS_LABEL: Record<QuoteSummary['status'], string> = {
  draft: 'Draft',
  sent: 'Sent',
  won: 'Won',
  lost: 'Lost',
}

/** Screen 5 — every quotation ever produced, with its audit trail attached. */
export default function History({ onOpen, onClone }: Props) {
  const { data, error, loading, reload } = useApi<{ quotes: QuoteSummary[] }>('/api/quotes')
  const [busy, setBusy] = useState<string | null>(null)

  async function withQuote(id: string, action: (q: Quote) => void) {
    setBusy(id)
    try {
      action(await apiGet<Quote>(`/api/quotes/${id}`))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold">History</h2>
        <button type="button" className="btn no-print" onClick={reload}>
          Refresh
        </button>
      </div>

      {loading && <p className="text-[13px] text-ink-muted">Loading…</p>}
      {error && <p className="text-[13px] text-drift">{error.message}</p>}

      {data && data.quotes.length === 0 && (
        <p className="panel p-6 text-[13px] text-ink-muted">
          Nothing saved yet. Quotations appear here the moment they take a reference.
        </p>
      )}

      {data && data.quotes.length > 0 && (
        <table className="panel w-full text-[13px]">
          <thead>
            <tr className="border-b border-rule-strong bg-paper-sunk text-left">
              <th className="label px-3 py-2">Reference</th>
              <th className="label px-3 py-2">Date</th>
              <th className="label px-3 py-2">Customer</th>
              <th className="label px-3 py-2 text-right">Total</th>
              <th className="label px-3 py-2">Status</th>
              <th className="px-3 py-2 no-print" />
            </tr>
          </thead>
          <tbody>
            {data.quotes.map((q) => (
              <tr key={q.id} className="border-b border-rule last:border-b-0 hover:bg-paper-sunk/40">
                <td className="ref px-3 py-2">
                  {q.ref}
                  {q.revision > 0 && (
                    <span className="ml-1.5 text-ink-faint">Rev {q.revision}</span>
                  )}
                </td>
                <td className="px-3 py-2">{formatDateLong(fromISODate(q.date))}</td>
                <td className="px-3 py-2">{q.customerName}</td>
                <td className="num px-3 py-2">{formatPaise(q.total)}</td>
                <td className="px-3 py-2 text-ink-muted">{STATUS_LABEL[q.status]}</td>
                <td className="px-3 py-2 no-print">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      className="btn px-2 py-0.5 text-[12px]"
                      disabled={busy !== null}
                      onClick={() => withQuote(q.id, onOpen)}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="btn px-2 py-0.5 text-[12px]"
                      disabled={busy !== null}
                      title="Start a new revision from this quotation, keeping its reference"
                      onClick={() => withQuote(q.id, onClone)}
                    >
                      Revise
                    </button>
                    <button
                      type="button"
                      className="btn px-2 py-0.5 text-[12px]"
                      disabled={busy !== null}
                      onClick={() => apiDownload('/api/render/docx', { quoteId: q.id })}
                    >
                      .docx
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
