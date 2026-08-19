import { useState } from 'react'
import type { CustomerRecord, ExtractedCustomer, ParsedLine, Quote, QuoteItem } from '@shared/schema'
import { itemsFromLines } from './lib/draft'
import { DEFAULT_SALESPERSON, DEFAULT_TERMS, GST_RATE_PERCENT } from '@shared/company'
import { endOfMonth, formatDateLong, toISODate } from '@shared/fy'
import { formatPaise } from '@shared/money'
import { taxModeForState } from '@shared/states'
import Source from './pages/Source'
import QuoteEditor, { type EditorItem, type QuoteDraft } from './pages/QuoteEditor'
import Stepper from './components/Stepper'
import History from './pages/History'

type Screen = 'source' | 'editor' | 'history'

/**
 * The two steps a quotation passes through — the document is no longer one of
 * them. It sits beside the form and updates as you type, so "edit" and "see the
 * result" stopped being separate places to be. History is not among them — it is
 * somewhere you go, not a stage you complete, and putting it in the sequence
 * would imply a quotation is unfinished until you have visited it.
 */
const FLOW: Array<{ screen: Screen; label: string; locked: string }> = [
  { screen: 'source', label: 'Email thread', locked: '' },
  { screen: 'editor', label: 'Quotation', locked: 'Read a thread first' },
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
  const [draft, setDraft] = useState<QuoteDraft | null>(null)
  const [saved, setSaved] = useState<Quote | null>(null)
  /** The exact thread text the current comparison was built from. */
  const [parsedThread, setParsedThread] = useState('')
  /** Lines the parser could not read as products — shown, never dropped. */
  const [skipped, setSkipped] = useState<string[]>([])
  /** Judgements the parser cannot make for the desk — e.g. a superseded price. */
  const [warnings, setWarnings] = useState<string[]>([])
  /** Customer details Claude read, offered on the quotation screen. */
  const [readCustomer, setReadCustomer] = useState<{
    extracted: ExtractedCustomer
    onFile: CustomerRecord | null
  } | null>(null)

  /**
   * The stepper lets you jump back to the thread, edit it, and jump forward
   * again — at which point the lines on screen came from text that no longer
   * exists. Say so rather than let a stale quotation look current.
   */
  const draftStale = parsedThread !== '' && thread.trim() !== parsedThread.trim()

  const reached: Record<Screen, boolean> = {
    source: true,
    editor: draft !== null,
    history: true,
  }

  // How far through the flow this quotation has got, so the stepper can fill
  // its track rather than only showing what happens to be clickable.
  const progress = draft !== null ? 1 : 0
  const activeStep = FLOW.findIndex((s) => s.screen === screen)

  function startNew() {
    setThread('')
    setSkipped([])
    setWarnings([])
    setReadCustomer(null)
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
      <main
        className={`mx-auto px-6 py-6 ${screen === 'editor' ? 'max-w-[1700px]' : 'max-w-6xl'}`}
      >
        {screen === 'source' && (
          <Source
            thread={thread}
            onThreadChange={setThread}
            onCustomerRead={(extracted, onFile) => setReadCustomer({ extracted, onFile })}
            onParsed={(nextLines, usedThread, notRead, notes) => {
              setThread(usedThread)
              setParsedThread(usedThread)
              const { items, setAside, assumedQty } = itemsFromLines(nextLines)
              setSkipped([...notRead, ...setAside])
              setWarnings([
                ...notes,
                // Never let an invented number reach a customer unannounced.
                ...(assumedQty > 0
                  ? [
                      `${assumedQty} line${assumedQty === 1 ? '' : 's'} had no quantity anywhere in the thread, ` +
                        `so ${assumedQty === 1 ? 'it has' : 'they have'} been set to 1. Check ` +
                        `${assumedQty === 1 ? 'it' : 'them'} against what the customer asked for before saving.`,
                    ]
                  : []),
              ])
              setDraft(newDraft(items))
              setSaved(null)
              setScreen('editor')
            }}
          />
        )}


        {screen === 'editor' && draft && (
          <QuoteEditor
            draft={draft}
            onDraftChange={setDraft}
            sourceThread={thread}
            skipped={skipped}
            warnings={warnings}
            stale={draftStale}
            readCustomer={readCustomer}
            onDismissReadCustomer={() => setReadCustomer(null)}
            saved={saved}
            onSaved={setSaved}
            onRevise={() => {
              if (!saved) return
              setDraft(draftFromQuote(saved, true))
              setSaved(null)
            }}
            onStartNew={startNew}
            onBack={() => setScreen('source')}
          />
        )}


        {screen === 'history' && (
          <History
            onOpen={(quote) => {
              // Opening a past quotation lands in the same one screen, with its
              // document beside it and its downloads live.
              setSaved(quote)
              setThread(quote.sourceThread)
              setParsedThread(quote.sourceThread)
              setSkipped([])
              setWarnings([])
              setDraft(draftFromQuote(quote, false))
              setScreen('editor')
            }}
            onClone={(quote) => {
              setThread(quote.sourceThread)
              setParsedThread(quote.sourceThread)
              setSaved(null)
              setSkipped([])
              setWarnings([])
              setDraft(draftFromQuote(quote, true))
              setScreen('editor')
            }}
          />
        )}
      </main>
    </div>
  )
}
