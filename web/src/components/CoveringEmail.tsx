import { useState } from 'react'
import { apiPost } from '../lib/api'
import Callout from './Callout'

interface Props {
  quoteId: string
  /** Hidden entirely when the server has no API key. */
  available: boolean
}

type Drafted = { ok: boolean; subject?: string; body?: string; reason?: string }

/**
 * The covering email that goes out with the quotation.
 *
 * Editable, because you will always want to change a line, and editing beats
 * regenerating. Copy only — this application does not send mail, which is a
 * different project with a different risk profile.
 */
export default function CoveringEmail({ quoteId, available }: Props) {
  const [busy, setBusy] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [drafted, setDrafted] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  if (!available) return null

  async function draft() {
    setBusy(true)
    setNote(null)
    try {
      const r = await apiPost<Drafted>('/api/draft-email', { quoteId })
      if (!r.ok) {
        setNote(r.reason ?? 'Could not draft the email.')
        return
      }
      setSubject(r.subject ?? '')
      setBody(r.body ?? '')
      setDrafted(true)
    } catch (err) {
      setNote((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`)
      setNote('Copied. Paste it into your mail client.')
    } catch {
      setNote('Could not reach the clipboard — select the text and copy it.')
    }
  }

  return (
    <div className="mt-4 no-print">
      <div className="mb-1.5 flex items-baseline justify-between">
        <h3 className="label">Covering email</h3>
        <span className="text-[11px] text-ink-faint">drafted, never sent · edit before using</span>
      </div>

      {!drafted ? (
        <button type="button" className="btn" onClick={draft} disabled={busy}>
          {busy ? 'Drafting…' : 'Draft covering email'}
        </button>
      ) : (
        <div className="panel p-3">
          <label className="label mb-1 block">Subject</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="field mb-3"
          />

          <label className="label mb-1 block">Body</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            className="field resize-y font-sans leading-relaxed"
          />

          <div className="mt-2 flex items-center gap-2">
            <button type="button" className="btn btn-primary" onClick={copy}>
              Copy
            </button>
            <button type="button" className="btn" onClick={draft} disabled={busy}>
              {busy ? 'Drafting…' : 'Draft again'}
            </button>
            <span className="grow" />
            <span className="text-[11px] text-ink-faint">
              check the reference and the total against the document
            </span>
          </div>
        </div>
      )}

      {note && (
        <Callout className="mt-2" label="Note">
          {note}
        </Callout>
      )}
    </div>
  )
}
