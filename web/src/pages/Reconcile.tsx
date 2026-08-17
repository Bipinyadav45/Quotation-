import { useMemo, useRef, useState } from 'react'
import type { ParsedLine, QuoteItem, ReconciledPair, ReconcileResponse } from '@shared/schema'
import { formatPaise, pad2 } from '@shared/money'
import { apiPost } from '../lib/api'
import Callout from '../components/Callout'
import DiffText from '../components/DiffText'
import ScreenHeader from '../components/ScreenHeader'

type Wording = 'ours' | 'customer'

interface Props {
  lines: ParsedLine[]
  pairs: ReconciledPair[]
  onLinesChange: (lines: ParsedLine[], pairs: ReconciledPair[]) => void
  onBuild: (items: QuoteItem[]) => void
  onBack: () => void
}

const rowKey = (pair: ReconciledPair) => `${pair.request?.id ?? '-'}|${pair.offer?.id ?? '-'}`

/**
 * Screen 2 — "Ask vs quote".
 *
 * This screen is the product. Everything else is data entry and document
 * plumbing; this is the part that catches the silent errors. Amber appears
 * here and nowhere else in the application, so its presence always means
 * "look here".
 */
export default function Reconcile({ lines, pairs, onLinesChange, onBuild, onBack }: Props) {
  const [reviewed, setReviewed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const flagged = pairs.filter((p) => p.flags.length > 0)
  const clean = pairs.length - flagged.length

  const unreviewed = useMemo(
    () => flagged.filter((pair) => !reviewed.has(rowKey(pair))).length,
    [flagged, reviewed],
  )

  /** §5 — "The UI must let a user flip any line's role." */
  async function flipRole(lineId: string) {
    setBusy(true)
    setError(null)
    try {
      const next = lines.map((l) =>
        l.id === lineId
          ? {
              ...l,
              role: l.role === 'offer' ? ('request' as const) : ('offer' as const),
              roleUncertain: false,
            }
          : l,
      )
      const result = await apiPost<ReconcileResponse>('/api/reconcile', { lines: next })
      onLinesChange(next, result.pairs)
      setReviewed(new Set())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function jumpToNextIssue() {
    const target = flagged.find((pair) => !reviewed.has(rowKey(pair))) ?? flagged[0]
    if (target) {
      rowRefs.current[rowKey(target)]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  function build(wording: Wording) {
    const items: QuoteItem[] = pairs
      .filter((pair) => pair.request !== null || pair.offer !== null)
      .map((pair) => {
        // A request nobody quoted still becomes a line, at zero rate, so the
        // editor shows it. Silently dropping something the customer asked for
        // is the exact failure this screen exists to prevent.
        const source =
          wording === 'customer' ? (pair.request ?? pair.offer!) : (pair.offer ?? pair.request!)
        const priced = pair.offer ?? pair.request!
        return {
          desc: source.desc,
          make: pair.request?.make || pair.offer?.make || '',
          partCode: pair.request?.partCode || pair.offer?.partCode || '',
          qty: pair.request?.qty || pair.offer?.qty || 1,
          rate: priced.rate,
        }
      })
    onBuild(items)
  }

  return (
    <div className="max-w-6xl">
      <ScreenHeader
        step={2}
        title="Ask vs quote"
        purpose="Each row puts what the customer asked for beside what we are about to quote. Anything in amber differs between the two — check it before building the quotation."
        right={
          <div className="flex items-baseline gap-4 text-[13px] no-print">
            <span>
              <span className="num font-semibold">{pairs.length}</span>{' '}
              <span className="text-ink-muted">lines</span>
            </span>
            <span className={flagged.length > 0 ? 'text-drift' : 'text-ink-muted'}>
              <span className="num font-semibold">{flagged.length}</span> needing a look
            </span>
            <span className="text-ink-muted">
              <span className="num font-semibold">{clean}</span> clean
            </span>
            {flagged.length > 0 && (
              <button type="button" className="btn px-2 py-0.5 text-[12px]" onClick={jumpToNextIssue}>
                Jump to next
              </button>
            )}
          </div>
        }
      />

      {error && (
        <Callout tone="problem" label="Problem" className="mb-3">
          {error}
        </Callout>
      )}

      {pairs.length === 0 && (
        <Callout className="mb-3">
          Nothing was parsed out of that thread. Go back and check the paste — the parser needs the
          lines to carry a quantity or a price.
        </Callout>
      )}

      {flagged.length === 0 && pairs.length > 0 && (
        <Callout className="mb-3">
          Every line matches what the customer asked for. Nothing to check.
        </Callout>
      )}

      <div className="panel">
        <div className="grid grid-cols-2 border-b border-rule-strong bg-paper-sunk">
          <div className="label border-r border-rule px-3 py-2">What the customer asked for</div>
          <div className="label px-3 py-2">What we are about to quote</div>
        </div>

        {pairs.map((pair, index) => {
          const key = rowKey(pair)
          const isFlagged = pair.flags.length > 0
          const isReviewed = reviewed.has(key)
          const blocking = pair.flags.some((f) => f.severity === 'block')

          return (
            <div
              key={key}
              ref={(el) => (rowRefs.current[key] = el)}
              className={`border-b border-rule last:border-b-0 ${
                isFlagged ? 'row-flagged' : 'row-clean'
              }`}
            >
              {/* Row header — number, what is wrong, and the reviewed tick. */}
              <div className="flex items-center gap-3 px-3 pt-2">
                <span className="label">{pad2(index + 1)}</span>
                {isFlagged ? (
                  <span className="label text-drift">
                    {pair.flags.length} {pair.flags.length === 1 ? 'difference' : 'differences'}
                  </span>
                ) : (
                  <span className="label text-ink-faint">matches</span>
                )}

                {blocking && (
                  <label className="ml-auto flex cursor-pointer items-center gap-2 text-[12px] text-ink-muted no-print">
                    <input
                      type="checkbox"
                      checked={isReviewed}
                      onChange={() =>
                        setReviewed((prev) => {
                          const next = new Set(prev)
                          if (next.has(key)) next.delete(key)
                          else next.add(key)
                          return next
                        })
                      }
                      className="accent-accent"
                    />
                    Checked — this is deliberate
                  </label>
                )}
              </div>

              <div className="grid grid-cols-2">
                <Cell
                  line={pair.request}
                  other={pair.offer}
                  side="request"
                  highlight={isFlagged}
                  onFlip={flipRole}
                  busy={busy}
                />
                <Cell
                  line={pair.offer}
                  other={pair.request}
                  side="offer"
                  highlight={isFlagged}
                  onFlip={flipRole}
                  busy={busy}
                />
              </div>

              {isFlagged && (
                <div className="px-3 pb-2">
                  <div className="drift-strip space-y-0.5">
                    {pair.flags.map((flag, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="label shrink-0 text-drift">{flag.kind}</span>
                        <span className="grow">{flag.text}</span>
                        <span className="label shrink-0 text-drift">
                          {flag.severity === 'block' ? 'check this' : 'worth a look'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* --- build --- */}
      <div className="mt-4 grid grid-cols-2 gap-4 no-print">
        <div className="panel p-3">
          <button
            type="button"
            className="btn w-full"
            onClick={() => build('customer')}
            disabled={busy || pairs.length === 0}
          >
            Build with the customer’s wording
          </button>
          <p className="mt-2 text-[12px] text-ink-muted">
            Copies their descriptions across exactly as written. Usually the one to pick — their
            procurement system matches on its own wording, so it avoids a round-trip.
          </p>
        </div>

        <div className="panel p-3">
          <button
            type="button"
            className="btn btn-primary w-full"
            onClick={() => build('ours')}
            disabled={busy || pairs.length === 0}
          >
            Build with our wording
          </button>
          <p className="mt-2 text-[12px] text-ink-muted">
            Uses our descriptions. Pick this when ours are more precise — a fuller part number, or a
            spec the customer left out.
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 no-print">
        <button type="button" className="btn" onClick={onBack}>
          Back to thread
        </button>
        {unreviewed > 0 && (
          <p className="text-[12px] text-ink-muted">
            <span className="text-drift">{unreviewed}</span> still to check. You can build anyway —
            the tick records that the difference was deliberate, it does not lock anything.
          </p>
        )}
      </div>
    </div>
  )
}

interface CellProps {
  line: ParsedLine | null
  other: ParsedLine | null
  side: 'request' | 'offer'
  highlight: boolean
  onFlip: (id: string) => void
  busy: boolean
}

function Cell({ line, other, side, highlight, onFlip, busy }: CellProps) {
  const border = side === 'request' ? 'border-r border-rule' : ''

  if (!line) {
    return (
      <div className={`${border} px-3 py-2 text-[13px] text-ink-faint`}>
        {side === 'offer' ? 'Not quoted at all' : 'Not asked for'}
      </div>
    )
  }

  return (
    <div className={`${border} px-3 py-2`}>
      <p className="text-[13px] leading-snug">
        <DiffText text={line.desc} against={other?.desc ?? ''} highlight={highlight} />
      </p>

      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px] text-ink-muted">
        {line.make && <span>{line.make}</span>}
        {line.partCode && <span className="font-mono">{line.partCode}</span>}
        {line.qty > 0 && (
          <span>
            <span className="label">qty</span> <span className="num">{pad2(line.qty)}</span>
          </span>
        )}
        {line.rate > 0 && (
          <span>
            <span className="label">rate</span> <span className="num">{formatPaise(line.rate)}</span>
          </span>
        )}

        <button
          type="button"
          className="ml-auto border border-rule px-1.5 py-0.5 text-[11px] hover:bg-paper-sunk no-print"
          onClick={() => onFlip(line.id)}
          disabled={busy}
          title={
            side === 'offer'
              ? 'This is actually something the customer asked for, not something we are quoting'
              : 'This is actually something we are quoting, not something the customer asked for'
          }
        >
          {side === 'offer' ? 'Move to the ask side' : 'Move to the quote side'}
        </button>
      </div>

      {line.roleUncertain && (
        <p className="mt-1.5 text-[11px] text-drift no-print">
          This line has a price but came from the customer, so it may belong on the other side.
        </p>
      )}
    </div>
  )
}
