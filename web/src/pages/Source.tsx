import { useState } from 'react'
import type { ParsedLine, ParseResponse, ReconciledPair, ReconcileResponse } from '@shared/schema'
import { SAMPLE_THREAD } from '@shared/sample'
import { apiPost, useApi } from '../lib/api'

interface Props {
  thread: string
  onThreadChange: (thread: string) => void
  onParsed: (lines: ParsedLine[], pairs: ReconciledPair[], thread: string) => void
}

/** Screen 1 — the email thread goes in here and nowhere else. */
export default function Source({ thread, onThreadChange, onParsed }: Props) {
  const [busy, setBusy] = useState<'pattern' | 'llm' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  // §5's Claude path needs a key. Without one the button is hidden rather than
  // offered and then failing.
  const capabilities = useApi<{ llm: boolean }>('/api/capabilities')

  async function parse(endpoint: '/api/parse' | '/api/parse/llm') {
    setBusy(endpoint === '/api/parse' ? 'pattern' : 'llm')
    setError(null)
    setNote(null)
    try {
      const parsed = await apiPost<ParseResponse>(endpoint, { thread })
      const reconciled = await apiPost<ReconcileResponse>('/api/reconcile', {
        lines: parsed.lines,
      })
      // §5 — a Claude failure comes back as the pattern result plus a note, not
      // an error page. Carry the note through so the desk knows what happened.
      if (parsed.note) setNote(parsed.note)
      onParsed(parsed.lines, reconciled.pairs, thread)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
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
          onClick={() => parse('/api/parse')}
          disabled={busy !== null || thread.trim() === ''}
        >
          {busy === 'pattern' ? 'Parsing…' : 'Parse thread'}
        </button>

        {capabilities.data?.llm && (
          <button
            type="button"
            className="btn"
            onClick={() => parse('/api/parse/llm')}
            disabled={busy !== null || thread.trim() === ''}
            title="For threads the patterns cannot handle — pasted tables, prose quotations"
          >
            {busy === 'llm' ? 'Asking Claude…' : 'Parse with Claude'}
          </button>
        )}

        <button
          type="button"
          className="btn"
          onClick={() => onThreadChange(SAMPLE_THREAD)}
          disabled={busy !== null}
        >
          Load sample
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            onThreadChange('')
            setError(null)
            setNote(null)
          }}
          disabled={busy !== null || thread === ''}
        >
          Clear
        </button>
      </div>

      {note && <p className="mt-3 text-[13px] text-drift">{note}</p>}
      {error && <p className="mt-3 text-[13px] text-drift">{error}</p>}
    </div>
  )
}
