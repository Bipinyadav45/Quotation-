import { useState } from 'react'
import type { Quote, QuoteItem, ResolvedCustomer } from '@shared/schema'
import { itemsFromLines } from './lib/draft'
import { DEFAULT_SALESPERSON, DEFAULT_TERMS, GST_RATE_PERCENT } from '@shared/company'
import { endOfMonth, formatDateLong, toISODate } from '@shared/fy'
import { formatPaise } from '@shared/money'
import { taxModeForState } from '@shared/states'
import Source, { type ReadResult } from './pages/Source'
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

/**
 * A draft is now born with its customer already in it, rather than blank with
 * the details offered for acceptance afterwards.
 *
 * The ship-to state has to travel with the customer, not after them: it decides
 * whether the document shows one IGST row or a CGST/SGST pair, so a customer
 * applied without their state would quote the wrong tax split until someone
 * noticed.
 */
function newDraft(
  items: QuoteItem[],
  customer?: ResolvedCustomer | null,
  validity?: string | null,
): QuoteDraft {
  const today = new Date()
  const filled = customer ?? { name: '', address: '', attention: '', gstin: '', state: '' }

  return {
    date: toISODate(today),
    initials: DEFAULT_SALESPERSON.initials,
    customer: filled,
    contact: DEFAULT_SALESPERSON.phone,
    email: DEFAULT_SALESPERSON.email,
    signatory: DEFAULT_SALESPERSON.name,
    items: items.map(toEditorItem),
    tax: { mode: taxModeForState(filled.state || undefined), rate: GST_RATE_PERCENT },
    terms: {
      ...DEFAULT_TERMS,
      // What WE told this customer in the thread beats the end of the month.
      // The server works it out, because only the server knows who wrote which
      // line — read over the raw text, the customer's own "valid for 90 days"
      // came back as our contractual term. Absent means nobody said, and the
      // default stands.
      validity: validity ?? formatDateLong(endOfMonth(today)),
    },
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

/**
 * What the review panel used to say by showing you every value beside the one
 * on file, now that nothing is shown and the details go straight in.
 *
 * It warns at MEDIUM as well as low. The panel could afford to stay quiet at
 * medium because it printed each value for inspection; nothing is printed now,
 * and the extractor's own prompt defines medium as "you had to infer" — an
 * inferred address must not reach a tax document unannounced.
 */
function customerWarnings(result: ReadResult): string[] {
  // undefined means nobody looked: the plain parser reads lines, not customers.
  if (result.customer === undefined) return []

  if (result.customer === null) {
    return [
      result.customerNote ??
        'The customer could not be read from this thread. Type the details in below.',
    ]
  }

  const out: string[] = []
  const applied = Object.values(result.customer).some((value) => value !== '')

  // Only worth saying if something was actually filled in. A read that came
  // back empty — the internal-domain guard wiping our own details, say — needs
  // "nothing was filled in", not "check what was".
  if (applied && (result.customerConfidence === 'low' || result.customerConfidence === 'medium')) {
    out.push(
      `The customer details were ${result.customerConfidence === 'low' ? 'a guess' : 'partly inferred'}` +
        ' rather than read plainly, and they have been filled in below. Check the name, address' +
        ' and ship-to state before saving — the state decides the tax split.',
    )
  }

  if (!applied) {
    out.push(
      'No customer details could be taken from this thread, so none were filled in.' +
        ' Type them in below.',
    )
  }

  // 'both' is the ordinary repeat-customer case and says nothing worth reading;
  // warning on it would fire on nearly every quotation and train the desk to
  // scroll past the whole strip. What matters is the two cases where the
  // thread's own words did NOT survive.
  if (applied && result.customerFrom === 'on-file') {
    out.push(
      'This thread named no customer, so the details came from your customer list.' +
        ' Check they are still the right ones to quote.',
    )
  }

  const conflicts = result.customerConflicts ?? []
  if (conflicts.length > 0) {
    out.push(
      `The thread gives a different ${conflicts.join(', ')} from your customer list.` +
        ' What is on file was used, being the version someone confirmed by saving it —' +
        ' change it below if they have moved.',
    )
  }

  if (result.customerMissing && result.customerMissing.length > 0) {
    out.push(
      `Not in the thread and not on file: ${result.customerMissing.join(', ')}.` +
        ' Left blank rather than guessed.',
    )
  }

  if (result.customerNote) out.push(result.customerNote)

  return out
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('source')
  const [thread, setThread] = useState('')
  const [draft, setDraft] = useState<QuoteDraft | null>(null)
  const [saved, setSaved] = useState<Quote | null>(null)
  /**
   * The customer the AI last resolved, kept so a second read does not wipe it.
   *
   * "Read the thread" looks at line items and forms no opinion about the
   * customer, so it must not overwrite one — and with the review panel gone
   * there is no longer anywhere to get it back from short of pressing the AI
   * button again.
   */
  const [lastCustomer, setLastCustomer] = useState<ResolvedCustomer | null>(null)
  /** The exact thread text the current comparison was built from. */
  const [parsedThread, setParsedThread] = useState('')
  /** Lines the parser could not read as products — shown, never dropped. */
  const [skipped, setSkipped] = useState<string[]>([])
  /** Judgements the parser cannot make for the desk — e.g. a superseded price. */
  const [warnings, setWarnings] = useState<string[]>([])

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
    setLastCustomer(null)
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
      <main
        className={`mx-auto px-6 py-6 ${screen === 'editor' ? 'max-w-[1700px]' : 'max-w-6xl'}`}
      >
        {screen === 'source' && (
          <Source
            thread={thread}
            onThreadChange={setThread}
            onRead={(result, usedThread) => {
              setThread(usedThread)
              setParsedThread(usedThread)

              const { items, setAside, assumedQty, warnings: carryWarnings } =
                itemsFromLines(result.lines)
              setSkipped([...result.skipped, ...setAside])

              setWarnings([
                // Why the AI reader fell back to the plain one, when it did.
                ...(result.note ? [result.note] : []),
                ...result.warnings,
                // Never let an invented number reach a customer unannounced.
                ...(assumedQty > 0
                  ? [
                      `${assumedQty} line${assumedQty === 1 ? '' : 's'} had no quantity anywhere in the thread, ` +
                        `so ${assumedQty === 1 ? 'it has' : 'they have'} been set to 1. Check ` +
                        `${assumedQty === 1 ? 'it' : 'them'} against what the customer asked for before saving.`,
                    ]
                  : []),
                // The same rule line by line: a quantity fetched off the customer's own
                // request, and one refused for naming a different variant, are both
                // changes to what was quoted and neither may go out unsaid.
                ...carryWarnings,
                // Term 4 is a commitment about how long the price holds. Taken
                // off the thread it is only as good as the sentence it came
                // from, so it never lands silently — the same rule the carried
                // quantity follows.
                ...(result.suggestedValidity
                  ? [
                      `Validity has been set to "${result.suggestedValidity}", read from what we` +
                        ' told this customer in the thread. Check it against what you mean to' +
                        ' commit to before saving.',
                    ]
                  : []),
                ...customerWarnings(result),
              ])

              if (result.customer) setLastCustomer(result.customer)
              setDraft(newDraft(items, result.customer ?? lastCustomer, result.suggestedValidity))
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
