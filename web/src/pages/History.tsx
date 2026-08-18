import { useState } from 'react'
import type { Quote, QuoteSummary } from '@shared/schema'
import { formatPaise } from '@shared/money'
import { formatDateLong, fromISODate } from '@shared/fy'
import { apiDelete, apiDownload, apiGet, useApi } from '../lib/api'
import Callout from '../components/Callout'
import ScreenHeader from '../components/ScreenHeader'

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

const fullRef = (q: QuoteSummary) => (q.revision > 0 ? `${q.ref} Rev ${q.revision}` : q.ref)

/** Screen 5 — every quotation ever produced, with its audit trail attached. */
export default function History({ onOpen, onClone }: Props) {
  const { data, error, loading, reload } = useApi<{ quotes: QuoteSummary[] }>('/api/quotes')
  const [busy, setBusy] = useState<string | null>(null)
  /** Row awaiting a second click before it is deleted. */
  const [confirming, setConfirming] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function withQuote(id: string, action: (q: Quote) => void) {
    setBusy(id)
    try {
      action(await apiGet<Quote>(`/api/quotes/${id}`))
    } finally {
      setBusy(null)
    }
  }

  async function remove(quote: QuoteSummary) {
    setBusy(quote.id)
    setMessage(null)
    try {
      await apiDelete(`/api/quotes/${quote.id}`)
      setConfirming(null)
      setMessage(`Deleted ${fullRef(quote)}. The reference is not reused.`)
      reload()
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <ScreenHeader
        step={5}
        title="History"
        purpose="Every quotation ever sent, with the original email thread and the reconciliation stored against it — so a disputed line six weeks later has an answer."
        right={
          <button type="button" className="btn px-2 py-0.5 text-[12px] no-print" onClick={reload}>
            Refresh
          </button>
        }
      />

      {loading && <p className="text-[13px] text-ink-muted">Loading…</p>}
      {error && (
        <Callout tone="problem" label="Problem">
          {error.message}
        </Callout>
      )}

      {message && (
        <Callout className="mb-3 no-print" label="Done">
          {message}
        </Callout>
      )}

      {data && data.quotes.length === 0 && (
        <Callout>
          Nothing saved yet. A quotation appears here the moment it takes a reference number.
        </Callout>
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
            {data.quotes.map((q) => {
              const isConfirming = confirming === q.id
              const isSent = q.status !== 'draft'

              return (
                <tr
                  key={q.id}
                  className={`border-b border-rule last:border-b-0 ${
                    isConfirming ? 'bg-alert-bg' : 'hover:bg-paper-sunk/40'
                  }`}
                >
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
                    {isConfirming ? (
                      // Two steps rather than one, because this cannot be undone.
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-[12px] text-alert">
                          {isSent
                            ? 'Destroys the thread and reconciliation behind a sent quotation.'
                            : 'Delete this draft?'}
                        </span>
                        <button
                          type="button"
                          className="border border-alert-rule bg-alert px-2 py-0.5 text-[12px] text-paper-raised hover:opacity-90"
                          disabled={busy !== null}
                          onClick={() => remove(q)}
                        >
                          {busy === q.id ? 'Deleting…' : 'Delete'}
                        </button>
                        <button
                          type="button"
                          className="btn px-2 py-0.5 text-[12px]"
                          disabled={busy !== null}
                          onClick={() => setConfirming(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
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
                          title="Download the Word file again"
                          onClick={() => apiDownload('/api/render/docx', { quoteId: q.id })}
                        >
                          Word
                        </button>
                        <button
                          type="button"
                          className="btn px-2 py-0.5 text-[12px] text-alert hover:bg-alert-bg"
                          disabled={busy !== null}
                          title={
                            isSent
                              ? 'Deletes this quotation and its audit trail — it has already been sent'
                              : 'Delete this draft'
                          }
                          onClick={() => {
                            setMessage(null)
                            setConfirming(q.id)
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {data && data.quotes.length > 0 && (
        <p className="mt-3 text-[12px] text-ink-muted no-print">
          Deleting removes one row only — a revision goes without touching its siblings. The
          reference number is never reused.
        </p>
      )}
    </div>
  )
}
