import { useState } from 'react'
import type { AiReadResponse, ParsedLine, ParseResponse, ResolvedCustomer } from '@shared/schema'
import { SAMPLE_THREAD } from '@shared/sample'
import { apiPost, useApi } from '../lib/api'
import Callout from '../components/Callout'
import ScreenHeader from '../components/ScreenHeader'

/**
 * What either reader hands back.
 *
 * The plain parser fills the line half and leaves the customer half undefined;
 * the AI reader fills both in one pass. `customer: null` is NOT the same as
 * undefined — it means the customer read was attempted and failed, which is
 * worth saying out loud and worth pressing again. Undefined means nobody looked.
 */
export interface ReadResult {
  lines: ParsedLine[]
  skipped: string[]
  warnings: string[]
  /** Why the AI fell back to the plain parser, when it did. */
  note?: string
  customer?: ResolvedCustomer | null
  customerConfidence?: 'high' | 'medium' | 'low'
  customerFrom?: 'thread' | 'on-file' | 'both'
  customerMissing?: string[]
  /** Fields where the thread disagreed with the customer list and lost. */
  customerConflicts?: string[]
  customerNote?: string
  /** Term 4, when WE stated one in the thread. Computed server-side. */
  suggestedValidity?: string
}

interface Props {
  thread: string
  onThreadChange: (thread: string) => void
  onRead: (result: ReadResult, thread: string) => void
}

/** Screen 1 — the email thread goes in here and nowhere else. */
export default function Source({ thread, onThreadChange, onRead }: Props) {
  const [busy, setBusy] = useState<'pattern' | 'ai' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Without an API key the AI button is hidden rather than offered and then
  // failing. The application stays completely usable without it.
  const capabilities = useApi<{ llm: boolean; readWithAi: boolean }>('/api/capabilities')

  async function read(mode: 'pattern' | 'ai') {
    setBusy(mode)
    setError(null)
    try {
      if (mode === 'pattern') {
        const parsed = await apiPost<ParseResponse>('/api/parse', { thread })
        onRead(
          {
            lines: parsed.lines,
            skipped: parsed.skipped ?? [],
            warnings: parsed.warnings ?? [],
            suggestedValidity: parsed.suggestedValidity,
          },
          thread,
        )
        return
      }

      // One call now does what two buttons used to: the line items and the
      // customer, read together and applied together. It answers 200 even when
      // half of it failed, so there is nothing to catch here beyond the network
      // itself — whatever worked comes back, and what did not says why.
      const r = await apiPost<AiReadResponse>('/api/parse/ai', { thread })
      onRead(
        {
          lines: r.lines,
          skipped: r.skipped ?? [],
          warnings: r.warnings ?? [],
          note: r.note,
          customer: r.customer,
          customerConfidence: r.customerConfidence,
          customerFrom: r.customerFrom,
          customerMissing: r.customerMissing ?? [],
          customerConflicts: r.customerConflicts ?? [],
          customerNote: r.customerNote,
          suggestedValidity: r.suggestedValidity,
        },
        thread,
      )
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

      {/* readOnly while a read is in flight: the request is built from the text
          as it was when the button was pressed, so an edit made while waiting
          was silently reverted when the answer came back — taking whatever the
          desk had just typed with it. */}
      <textarea
        value={thread}
        onChange={(e) => onThreadChange(e.target.value)}
        spellCheck={false}
        readOnly={busy !== null}
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
          onClick={() => read('pattern')}
          disabled={busy !== null || empty}
        >
          {busy === 'pattern' ? 'Reading the thread…' : 'Read the thread'}
        </button>

        {/* One button, not two. It used to take a separate press to read the
            customer, and the details then had to be accepted field by field
            before anything happened — so the common case was three actions to
            get one quotation started. */}
        {capabilities.data?.readWithAi && (
          <button
            type="button"
            className="btn"
            onClick={() => read('ai')}
            disabled={busy !== null || empty}
            title="Slower, and costs a little. Reads the line items AND fills in the customer's name, address, GSTIN and ship-to state. Worth it when the ordinary reader misses lines."
          >
            {busy === 'ai' ? 'Reading with AI…' : 'Read it with AI instead'}
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
          }}
          disabled={busy !== null || empty}
        >
          Clear
        </button>
      </div>

      {capabilities.data?.readWithAi && !empty && (
        <p className="mt-2 text-[12px] text-ink-muted">
          Start with <span className="font-medium">Read the thread</span>. Reach for the AI if lines
          are missing, if they landed on the wrong side, or to have the customer filled in for you.
        </p>
      )}

      {/* Anything either reader wants to say about what it did lands on the next
          screen beside the quotation it affected, not here — this screen is gone
          the moment the thread has been read. */}
      {error && (
        <Callout tone="problem" label="Problem" className="mt-3">
          {error}
        </Callout>
      )}
    </div>
  )
}
