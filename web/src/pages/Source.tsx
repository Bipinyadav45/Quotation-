import { useState } from 'react'
import type { ParsedLine, ParseResponse, ReconciledPair, ReconcileResponse } from '@shared/schema'
import { SAMPLE_THREAD } from '@shared/sample'
import { apiPost } from '../lib/api'

interface Props {
  thread: string
  onThreadChange: (thread: string) => void
  onParsed: (lines: ParsedLine[], pairs: ReconciledPair[], thread: string) => void
}

/** Screen 1 — the email thread goes in here and nowhere else. */
export default function Source({ thread, onThreadChange, onParsed }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function parse() {
    setBusy(true)
    setError(null)
    try {
      const parsed = await apiPost<ParseResponse>('/api/parse', { thread })
      const reconciled = await apiPost<ReconcileResponse>('/api/reconcile', {
        lines: parsed.lines,
      })
      onParsed(parsed.lines, reconciled.pairs, thread)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const lineCount = thread === '' ? 0 : thread.split(/\r?\n/).length

  return (
    <div className="max-w-5xl">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold">Email thread</h2>
        <span className="label">{lineCount} lines pasted</span>
      </div>

      <textarea
        value={thread}
        onChange={(e) => onThreadChange(e.target.value)}
        spellCheck={false}
        placeholder="Paste the whole thread — both sides, quoting and all. The parser splits it on the &quot;wrote:&quot; and &quot;From:&quot; headers and works out which side wrote each line."
        className="h-[26rem] w-full resize-y border border-rule bg-paper-raised p-3
                   font-mono text-[13px] leading-relaxed placeholder:text-ink-faint"
      />

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          className="btn btn-primary"
          onClick={parse}
          disabled={busy || thread.trim() === ''}
        >
          {busy ? 'Parsing…' : 'Parse thread'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => onThreadChange(SAMPLE_THREAD)}
          disabled={busy}
        >
          Load sample
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            onThreadChange('')
            setError(null)
          }}
          disabled={busy || thread === ''}
        >
          Clear
        </button>
      </div>

      {error && <p className="mt-3 text-[13px] text-drift">{error}</p>}
    </div>
  )
}
