import { useState } from 'react'
import type { ParsedLine, Quote, QuoteItem, ReconciledPair } from '@shared/schema'
import { DEFAULT_SALESPERSON, DEFAULT_TERMS, GST_RATE_PERCENT } from '@shared/company'
import { endOfMonth, formatDateLong, toISODate } from '@shared/fy'
import { formatPaise } from '@shared/money'
import { taxModeForState } from '@shared/states'
import Source from './pages/Source'
import Reconcile from './pages/Reconcile'
import QuoteEditor, { type EditorItem, type QuoteDraft } from './pages/QuoteEditor'
import Stepper from './components/Stepper'
import Preview from './pages/Preview'
import History from './pages/History'

type Screen = 'source' | 'reconcile' | 'editor' | 'document' | 'history'

/**
 * The four steps a quotation passes through. History is not among them — it is
 * somewhere you go, not a stage you complete, and putting it in the sequence
 * would imply a quotation is unfinished until you have visited it.
 */
const FLOW: Array<{ screen: Screen; label: string; locked: string }> = [
  { screen: 'source', label: 'Email thread', locked: '' },
  { screen: 'reconcile', label: 'Ask vs quote', locked: 'Read a thread first' },
  { screen: 'editor', label: 'Quotation', locked: 'Build from the ask-vs-quote screen first' },
  { screen: 'document', label: 'Document', locked: 'Save the quotation first' },
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
  /** The exact thread text the current comparison was built from. */
  const [parsedThread, setParsedThread] = useState('')
  /** Lines the parser could not read as products — shown, never dropped. */
  const [skipped, setSkipped] = useState<string[]>([])
  /** Judgements the parser cannot make for the desk — e.g. a superseded price. */
  const [warnings, setWarnings] = useState<string[]>([])

  /**
   * Now that the stepper lets you jump back to the thread, edit it, and jump
   * forward again, the comparison on screen can be built from text that no
   * longer exists. Silently showing a stale reconciliation is precisely the
   * class of error this product exists to prevent, so say so.
   */
  const reconciliationStale = parsedThread !== '' && thread.trim() !== parsedThread.trim()

  const reached: Record<Screen, boolean> = {
    source: true,
    reconcile: pairs.length > 0,
    editor: draft !== null,
    document: saved !== null,
    history: true,
  }

  // How far through the flow this quotation has got, so the stepper can fill
  // its track rather than only showing what happens to be clickable.
  const progress = saved !== null ? 3 : draft !== null ? 2 : pairs.length > 0 ? 1 : 0
  const activeStep = FLOW.findIndex((s) => s.screen === screen)

  function startNew() {
    setThread('')
    setLines([])
    setPairs([])
    setSkipped([])
    setWarnings([])
    setDraft(null)
    setSaved(null)
    setScreen('source')
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-rule-strong bg-paper-raised no-print">
        {/* Same container as <main>, so the title sits on the same axis as the
            content below it rather than drifting to the window edge. */}
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex items-baseline justify-between gap-6 pb-2 pt-3">
            <h1 className="text-[15px] font-semibold tracking-tight">
              Quotation Desk
              <span className="ml-2 font-normal text-ink-faint">Newtech Computer Services</span>
            </h1>

            <div className="flex items-center gap-2">
              {progress > 0 && (
                <button type="button" className="btn px-2 py-0.5 text-[12px]" onClick={startNew}>
                  New quotation
                </button>
              )}
              <button
                type="button"
                onClick={() => setScreen('history')}
                className={`border px-2 py-0.5 text-[12px] ${
                  screen === 'history'
                    ? 'border-accent bg-accent-faint text-accent'
                    : 'border-rule bg-paper-raised hover:bg-paper-sunk'
                }`}
              >
                History
              </button>
            </div>
          </div>

          <div className="pb-3">
            <Stepper
              steps={FLOW.map((step) => ({
                label: step.label,
                available: reached[step.screen],
                locked: step.locked,
              }))}
              active={activeStep === -1 ? null : activeStep}
              progress={progress}
              onSelect={(i) => setScreen(FLOW[i]!.screen)}
            />
          </div>
        </div>
      </header>

      {/* The app's one content column. Screens do not set their own width —
          otherwise they disagree and the layout jumps as you move between them. */}
      <main className="mx-auto max-w-6xl px-6 py-6">
        {screen === 'source' && (
          <Source
            thread={thread}
            onThreadChange={setThread}
            onParsed={(nextLines, nextPairs, usedThread, notRead, notes) => {
              setLines(nextLines)
              setPairs(nextPairs)
              setThread(usedThread)
              setParsedThread(usedThread)
              setSkipped(notRead)
              setWarnings(notes)
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
            stale={reconciliationStale}
            skipped={skipped}
            warnings={warnings}
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
