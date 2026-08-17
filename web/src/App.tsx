import { useState } from 'react'
import type { ParsedLine, Quote, QuoteItem, ReconciledPair } from '@shared/schema'
import { DEFAULT_SALESPERSON, DEFAULT_TERMS, GST_RATE_PERCENT } from '@shared/company'
import { endOfMonth, formatDateLong, toISODate } from '@shared/fy'
import { formatPaise } from '@shared/money'
import { taxModeForState } from '@shared/states'
import Source from './pages/Source'
import Reconcile from './pages/Reconcile'
import QuoteEditor, { type EditorItem, type QuoteDraft } from './pages/QuoteEditor'
import Preview from './pages/Preview'
import History from './pages/History'

type Screen = 'source' | 'reconcile' | 'editor' | 'document' | 'history'

const STEPS: Array<{ screen: Screen; n: number; label: string; locked: string }> = [
  { screen: 'source', n: 1, label: 'Email thread', locked: '' },
  { screen: 'reconcile', n: 2, label: 'Ask vs quote', locked: 'Read a thread first' },
  { screen: 'editor', n: 3, label: 'Quotation', locked: 'Build from the ask-vs-quote screen first' },
  { screen: 'document', n: 4, label: 'Document', locked: 'Save the quotation first' },
  { screen: 'history', n: 5, label: 'History', locked: '' },
]

const toEditorItem = (item: QuoteItem): EditorItem => ({
  key: crypto.randomUUID(),
  desc: item.desc,
  make: item.make,
  partCode: item.partCode,
  hsn: item.hsn ?? '',
  qty: item.qty,
  rate: item.rate,
  rateText: formatPaise(item.rate),
})

function newDraft(items: QuoteItem[]): QuoteDraft {
  const today = new Date()
  return {
    date: toISODate(today),
    initials: DEFAULT_SALESPERSON.initials,
    customer: { name: '', address: '', attention: '', gstin: '', state: '' },
    contact: DEFAULT_SALESPERSON.phone,
    email: DEFAULT_SALESPERSON.email,
    signatory: DEFAULT_SALESPERSON.name,
    items: items.map(toEditorItem),
    tax: { mode: taxModeForState(undefined), rate: GST_RATE_PERCENT },
    terms: { ...DEFAULT_TERMS, validity: formatDateLong(endOfMonth(today)) },
  }
}

/** §10 — clone an existing quote as the basis for a revision. */
function draftFromQuote(quote: Quote, asRevision: boolean): QuoteDraft {
  return {
    date: quote.date,
    initials: DEFAULT_SALESPERSON.initials,
    customer: {
      name: quote.customer.name,
      address: quote.customer.address,
      attention: quote.customer.attention,
      gstin: quote.customer.gstin ?? '',
      state: quote.customer.state ?? '',
    },
    contact: quote.contact,
    email: quote.email,
    signatory: quote.signatory,
    items: quote.items.map(toEditorItem),
    tax: quote.tax,
    terms: quote.terms,
    ...(asRevision ? { reviseOf: quote.id, reviseOfRef: quote.ref } : {}),
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('source')
  const [thread, setThread] = useState('')
  const [lines, setLines] = useState<ParsedLine[]>([])
  const [pairs, setPairs] = useState<ReconciledPair[]>([])
  const [draft, setDraft] = useState<QuoteDraft | null>(null)
  const [saved, setSaved] = useState<Quote | null>(null)

  const reached: Record<Screen, boolean> = {
    source: true,
    reconcile: pairs.length > 0,
    editor: draft !== null,
    document: saved !== null,
    history: true,
  }

  // How far through the flow this quotation has got, so the nav can show which
  // steps are behind you rather than just which are clickable.
  const doneUpTo = saved !== null ? 3 : draft !== null ? 2 : pairs.length > 0 ? 1 : 0

  function startNew() {
    setThread('')
    setLines([])
    setPairs([])
    setDraft(null)
    setSaved(null)
    setScreen('source')
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-rule-strong bg-paper-raised no-print">
        {/* Same container as <main>, so the title sits on the same axis as the
            content below it rather than drifting to the window edge. */}
        <div className="mx-auto flex max-w-6xl items-baseline gap-6 px-6 py-3">
          <h1 className="text-[15px] font-semibold tracking-tight">
            Quotation Desk
            <span className="ml-2 font-normal text-ink-faint">Newtech Computer Services</span>
          </h1>
          <nav className="flex items-center gap-1 text-[13px]">
            {STEPS.map((step, i) => {
              const active = screen === step.screen
              const available = reached[step.screen]
              // A step you have been past and could go back to.
              const done = available && !active && step.screen !== 'history' && doneUpTo > i

              return (
                <div key={step.n} className="flex items-center">
                  {i > 0 && <span className="px-1 text-rule-strong">›</span>}
                  <button
                    type="button"
                    disabled={!available}
                    onClick={() => setScreen(step.screen)}
                    title={available ? undefined : step.locked}
                    className={`border px-2 py-1 ${
                      active
                        ? 'border-accent bg-accent-faint font-medium text-accent'
                        : done
                          ? 'border-transparent text-ink hover:bg-paper-sunk'
                          : 'border-transparent text-ink-muted hover:bg-paper-sunk'
                    } disabled:cursor-not-allowed disabled:text-ink-faint/60 disabled:hover:bg-transparent`}
                  >
                    <span className={`label mr-1.5 ${done ? 'text-accent' : ''}`}>
                      {done ? '✓' : String(step.n).padStart(2, '0')}
                    </span>
                    {step.label}
                  </button>
                </div>
              )
            })}
          </nav>
        </div>
      </header>

      {/* The app's one content column. Screens do not set their own width —
          otherwise they disagree and the layout jumps as you move between them. */}
      <main className="mx-auto max-w-6xl px-6 py-6">
        {screen === 'source' && (
          <Source
            thread={thread}
            onThreadChange={setThread}
            onParsed={(nextLines, nextPairs, usedThread) => {
              setLines(nextLines)
              setPairs(nextPairs)
              setThread(usedThread)
              setScreen('reconcile')
            }}
          />
        )}

        {screen === 'reconcile' && (
          <Reconcile
            lines={lines}
            pairs={pairs}
            onLinesChange={(nextLines, nextPairs) => {
              setLines(nextLines)
              setPairs(nextPairs)
            }}
            onBuild={(items) => {
              setDraft(newDraft(items))
              setScreen('editor')
            }}
            onBack={() => setScreen('source')}
          />
        )}

        {screen === 'editor' && draft && (
          <QuoteEditor
            draft={draft}
            onDraftChange={setDraft}
            sourceThread={thread}
            reconciliation={pairs}
            onSaved={(quote) => {
              setSaved(quote)
              setScreen('document')
            }}
            onBack={() => setScreen(pairs.length > 0 ? 'reconcile' : 'history')}
          />
        )}

        {screen === 'document' && saved && (
          <Preview
            quote={saved}
            onRevise={() => {
              setDraft(draftFromQuote(saved, true))
              setScreen('editor')
            }}
            onStartNew={startNew}
          />
        )}

        {screen === 'history' && (
          <History
            onOpen={(quote) => {
              setSaved(quote)
              setThread(quote.sourceThread)
              setPairs(quote.reconciliation)
              setScreen('document')
            }}
            onClone={(quote) => {
              setThread(quote.sourceThread)
              setPairs(quote.reconciliation)
              setDraft(draftFromQuote(quote, true))
              setScreen('editor')
            }}
          />
        )}
      </main>
    </div>
  )
}
