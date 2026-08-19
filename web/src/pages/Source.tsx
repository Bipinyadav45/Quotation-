import { useState } from 'react'
import type { CustomerRecord, ExtractedCustomer, ParsedLine, ParseResponse } from '@shared/schema'
import { SAMPLE_THREAD } from '@shared/sample'
import { apiPost, useApi } from '../lib/api'
import Callout from '../components/Callout'
import ScreenHeader from '../components/ScreenHeader'

interface Props {
  thread: string
  onThreadChange: (thread: string) => void
  onParsed: (
    lines: ParsedLine[],
    thread: string,
    skipped: string[],
    warnings: string[],
  ) => void
  /** Customer details read from the thread, carried into the editor. */
  onCustomerRead: (extracted: ExtractedCustomer, onFile: CustomerRecord | null) => void
}

/** Screen 1 — the email thread goes in here and nowhere else. */
export default function Source({ thread, onThreadChange, onParsed, onCustomerRead }: Props) {
  const [busy, setBusy] = useState<'pattern' | 'llm' | 'customer' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  // §5's Claude path needs a key. Without one the button is hidden rather than
  // offered and then failing.
  const capabilities = useApi<{ llm: boolean; extractCustomer: boolean }>('/api/capabilities')

  async function parse(endpoint: '/api/parse' | '/api/parse/llm') {
    setBusy(endpoint === '/api/parse' ? 'pattern' : 'llm')
    setError(null)
    setNote(null)
    try {
      const parsed = await apiPost<ParseResponse>(endpoint, { thread })
      // §5 — a Claude failure comes back as the pattern result plus a note, not
      // an error page. Carry the note through so the desk knows what happened.
      if (parsed.note) setNote(parsed.note)
      onParsed(parsed.lines, thread, parsed.skipped ?? [], parsed.warnings ?? [])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const lineCount = thread.trim() === '' ? 0 : thread.trim().split(/\r?\n/).length
  const empty = thread.trim() === ''

  return (
    <div>
      <ScreenHeader
        step={1}
        title="Email thread"
        purpose="Paste the whole thread. The products in it become the lines of the quotation, which you then check and edit."
        right={
          <span className="label no-print">
            {lineCount === 0 ? 'nothing pasted' : `${lineCount} lines pasted`}
          </span>
        }
      />

      {empty && (
        <Callout className="mb-3" label="How it works">
          The parser splits the thread on its <span className="font-mono">wrote:</span> and{' '}
          <span className="font-mono">From:</span> headers to work out who wrote each line, then
          picks out anything carrying a quantity or a price, and turns each into a line of the
          quotation. Nothing is final — every line can be edited, reordered or deleted on the next
          screen.
        </Callout>
      )}

      <textarea
        value={thread}
        onChange={(e) => onThreadChange(e.target.value)}
        spellCheck={false}
        placeholder={
          'On Fri, Jul 10, 2026 at 5:52 PM rakhi gupte <rakhi.gupte@newtech.in> wrote:\n' +
          'Black i USB-C to USB-A 1.5 mtr, Qty- 02 - Rs. 550 + gst each\n' +
          '…\n\n' +
          'On Fri, Jul 10, 2026 at 1:24 PM <buyer@customer.com> wrote:\n' +
          'Black i USB-C to USB-A 1.5 mtr, Qty- 02\n' +
          '…'
        }
        className="h-[26rem] w-full resize-y border border-rule bg-paper-raised p-3
                   font-mono text-[13px] leading-relaxed placeholder:text-ink-faint/70"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => parse('/api/parse')}
          disabled={busy !== null || empty}
        >
          {busy === 'pattern' ? 'Reading the thread…' : 'Read the thread'}
        </button>

        {capabilities.data?.llm && (
          <button
            type="button"
            className="btn"
            onClick={() => parse('/api/parse/llm')}
            disabled={busy !== null || empty}
            title="Slower, and costs a little. Worth it when the ordinary reader misses lines."
          >
            {busy === 'llm' ? 'Reading with AI…' : 'Read it with AI instead'}
          </button>
        )}

        {capabilities.data?.extractCustomer && (
          <button
            type="button"
            className="btn"
            onClick={async () => {
              setBusy('customer')
              setError(null)
              try {
                const r = await apiPost<{
                  ok: boolean
                  extracted?: ExtractedCustomer
                  onFile?: CustomerRecord | null
                  reason?: string
                }>('/api/extract-customer', { thread })
                if (!r.ok || !r.extracted) setError(r.reason ?? 'Could not read the customer.')
                else onCustomerRead(r.extracted, r.onFile ?? null)
              } catch (err) {
                setError((err as Error).message)
              } finally {
                setBusy(null)
              }
            }}
            disabled={busy !== null || empty}
            title="Reads the customer's name, address, GSTIN and contact out of the thread"
          >
            {busy === 'customer' ? 'Reading…' : 'Read customer details'}
          </button>
        )}

        <span className="grow" />

        <button
          type="button"
          className="btn"
          onClick={() => onThreadChange(SAMPLE_THREAD)}
          disabled={busy !== null}
          title="Loads a real thread so you can see what the next screen does"
        >
          Load example
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            onThreadChange('')
            setError(null)
            setNote(null)
          }}
          disabled={busy !== null || empty}
        >
          Clear
        </button>
      </div>

      {capabilities.data?.llm && !empty && (
        <p className="mt-2 text-[12px] text-ink-muted">
          Start with <span className="font-medium">Read the thread</span>. Only reach for the AI if
          lines are missing or landed on the wrong side.
        </p>
      )}

      {note && (
        <Callout tone="drift" label="Note" className="mt-3">
          {note}
        </Callout>
      )}
      {error && (
        <Callout tone="problem" label="Problem" className="mt-3">
          {error}
        </Callout>
      )}
    </div>
  )
}
