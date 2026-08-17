import { useState } from 'react'
import type { ParsedLine, Quote, QuoteItem, ReconciledPair } from '@shared/schema'
import { DEFAULT_SALESPERSON, DEFAULT_TERMS, GST_RATE_PERCENT } from '@shared/company'
import { endOfMonth, formatDateLong, toISODate } from '@shared/fy'
import { formatPaise } from '@shared/money'
import { taxModeForState } from '@shared/states'
import Source from './pages/Source'
import Reconcile from './pages/Reconcile'
import QuoteEditor, { type EditorItem, type QuoteDraft } from './pages/QuoteEditor'

type Screen = 'source' | 'reconcile' | 'editor' | 'saved'

const STEPS: Array<{ screen: Screen; n: number; label: string }> = [
  { screen: 'source', n: 1, label: 'Email thread' },
  { screen: 'reconcile', n: 2, label: 'Ask vs quote' },
  { screen: 'editor', n: 3, label: 'Quotation' },
]

function newDraft(items: QuoteItem[]): QuoteDraft {
  const today = new Date()
  return {
    date: toISODate(today),
    initials: DEFAULT_SALESPERSON.initials,
    customer: { name: '', address: '', attention: '', gstin: '', state: '' },
    contact: DEFAULT_SALESPERSON.phone,
    email: DEFAULT_SALESPERSON.email,
    signatory: DEFAULT_SALESPERSON.name,
    items: items.map(
      (item): EditorItem => ({
        key: crypto.randomUUID(),
        desc: item.desc,
        make: item.make,
        partCode: item.partCode,
        hsn: item.hsn ?? '',
        qty: item.qty,
        rate: item.rate,
        rateText: formatPaise(item.rate),
      }),
    ),
    tax: { mode: taxModeForState(undefined), rate: GST_RATE_PERCENT },
    terms: {
      ...DEFAULT_TERMS,
      // §7 — validity defaults to the end of the current month.
      validity: formatDateLong(endOfMonth(today)),
    },
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
    saved: saved !== null,
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-rule-strong bg-paper-raised no-print">
        <div className="flex items-baseline gap-6 px-6 py-3">
          <h1 className="text-[15px] font-semibold tracking-tight">
            Quotation Desk
            <span className="ml-2 font-normal text-ink-faint">Newtech Computer Services</span>
          </h1>
          <nav className="flex gap-1 text-[13px]">
            {STEPS.map((step) => {
              const active = screen === step.screen
              const enabled = reached[step.screen]
              return (
                <button
                  key={step.n}
                  type="button"
                  disabled={!enabled}
                  onClick={() => setScreen(step.screen)}
                  className={`border px-2 py-1 ${
                    active
                      ? 'border-accent bg-accent-faint text-accent'
                      : 'border-transparent text-ink-muted hover:bg-paper-sunk'
                  } disabled:opacity-35 disabled:hover:bg-transparent`}
                >
                  <span className="label mr-1.5">{String(step.n).padStart(2, '0')}</span>
                  {step.label}
                </button>
              )
            })}
          </nav>
        </div>
      </header>

      <main className="px-6 py-6">
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
              setScreen('saved')
            }}
            onBack={() => setScreen('reconcile')}
          />
        )}

        {screen === 'saved' && saved && (
          <div className="panel max-w-2xl p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Saved</h2>
            <table className="w-full text-[13px]">
              <tbody>
                <tr className="border-b border-rule">
                  <td className="label py-2">Reference</td>
                  <td className="ref py-2">{saved.ref}</td>
                </tr>
                <tr className="border-b border-rule">
                  <td className="label py-2">Customer</td>
                  <td className="py-2">{saved.customer.name}</td>
                </tr>
                <tr className="border-b border-rule">
                  <td className="label py-2">Lines</td>
                  <td className="py-2">{saved.items.length}</td>
                </tr>
                <tr>
                  <td className="label py-2">Total</td>
                  <td className="num py-2 text-left font-semibold">
                    {formatPaise(saved.totals.total)}
                  </td>
                </tr>
              </tbody>
            </table>

            <p className="mt-4 text-[13px] text-ink-muted">
              The source thread and the full reconciliation are stored against this reference.
            </p>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setThread('')
                  setLines([])
                  setPairs([])
                  setDraft(null)
                  setSaved(null)
                  setScreen('source')
                }}
              >
                Start another quotation
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
