import { useMemo, useState } from 'react'
import type { ParsedLine, QuoteItem, ReconciledPair, ReconcileResponse } from '@shared/schema'
import { formatPaise, pad2 } from '@shared/money'
import { apiPost } from '../lib/api'

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

  const needingLook = pairs.filter((p) => p.flags.length > 0).length

  const unreviewedBlocks = useMemo(
    () =>
      pairs.filter(
        (pair) => pair.flags.some((f) => f.severity === 'block') && !reviewed.has(rowKey(pair)),
      ).length,
    [pairs, reviewed],
  )

  /** §5 — "The UI must let a user flip any line's role." */
  async function flipRole(lineId: string) {
    setBusy(true)
    try {
      const next = lines.map((l) =>
        l.id === lineId
          ? { ...l, role: l.role === 'offer' ? ('request' as const) : ('offer' as const), roleUncertain: false }
          : l,
      )
      const result = await apiPost<ReconcileResponse>('/api/reconcile', { lines: next })
      onLinesChange(next, result.pairs)
      setReviewed(new Set())
    } finally {
      setBusy(false)
    }
  }

  function toggleReviewed(key: string) {
    setReviewed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function build(wording: Wording) {
    const items: QuoteItem[] = pairs
      // A request nobody quoted still becomes a line, at zero rate, so the
      // editor shows it. Silently dropping something the customer asked for is
      // the exact failure this screen exists to prevent.
      .filter((pair) => pair.request !== null || pair.offer !== null)
      .map((pair) => {
        const source = wording === 'customer' ? (pair.request ?? pair.offer!) : (pair.offer ?? pair.request!)
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
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold">Ask vs quote</h2>
        <span className="label">
          {pairs.length} lines
          <span className="mx-1.5 text-rule-strong">·</span>
          <span className={needingLook > 0 ? 'text-drift' : ''}>{needingLook} needing a look</span>
        </span>
      </div>

      <div className="panel">
        <div className="grid grid-cols-2 border-b border-rule-strong bg-paper-sunk">
          <div className="label border-r border-rule px-3 py-2">What the customer asked for</div>
          <div className="label px-3 py-2">What we are about to quote</div>
        </div>

        {pairs.length === 0 && (
          <p className="px-3 py-6 text-[13px] text-ink-muted">
            Nothing parsed out of that thread. Check the paste, or flip a line’s role.
          </p>
        )}

        {pairs.map((pair, index) => {
          const key = rowKey(pair)
          const isReviewed = reviewed.has(key)
          const blocking = pair.flags.some((f) => f.severity === 'block')

          return (
            <div key={key} className="border-b border-rule last:border-b-0">
              <div className="grid grid-cols-2">
                <Cell line={pair.request} side="request" onFlip={flipRole} busy={busy} index={index} />
                <Cell line={pair.offer} side="offer" onFlip={flipRole} busy={busy} index={index} />
              </div>

              {pair.flags.length > 0 && (
                <div className="px-3 pb-2">
                  <div className="drift-strip">
                    {pair.flags.map((flag, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="label shrink-0 text-drift">{flag.kind}</span>
                        <span>{flag.text}</span>
                        {flag.severity === 'block' && (
                          <span className="label shrink-0 text-drift">block</span>
                        )}
                      </div>
                    ))}
                  </div>

                  {blocking && (
                    <label className="mt-1.5 flex w-fit cursor-pointer items-center gap-2 text-[12px] text-ink-muted no-print">
                      <input
                        type="checkbox"
                        checked={isReviewed}
                        onChange={() => toggleReviewed(key)}
                        className="accent-accent"
                      />
                      I have checked this line and it is deliberate
                    </label>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 no-print">
        <button type="button" className="btn" onClick={onBack}>
          Back to thread
        </button>
        <span className="grow" />
        <button
          type="button"
          className="btn"
          onClick={() => build('customer')}
          disabled={busy || pairs.length === 0}
          title="Reuses the customer's own descriptions verbatim — usually what avoids the round-trip"
        >
          Build with the customer’s wording
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => build('ours')}
          disabled={busy || pairs.length === 0}
        >
          Build with our wording
        </button>
      </div>

      {unreviewedBlocks > 0 && (
        <p className="mt-2 text-right text-[12px] text-drift no-print">
          {unreviewedBlocks} line{unreviewedBlocks === 1 ? '' : 's'} still to check. You can build
          anyway — the tick is a record that the drift was deliberate, not a lock.
        </p>
      )}
    </div>
  )
}

interface CellProps {
  line: ParsedLine | null
  side: 'request' | 'offer'
  onFlip: (id: string) => void
  busy: boolean
  index: number
}

function Cell({ line, side, onFlip, busy, index }: CellProps) {
  const border = side === 'request' ? 'border-r border-rule' : ''

  if (!line) {
    return (
      <div className={`${border} px-3 py-2 text-[13px] text-ink-faint`}>
        {side === 'offer' ? 'Not quoted' : 'Not requested'}
      </div>
    )
  }

  return (
    <div className={`${border} px-3 py-2`}>
      <div className="flex items-baseline gap-2">
        <span className="label shrink-0">{pad2(index + 1)}</span>
        <span className="text-[13px] leading-snug">{line.desc}</span>
      </div>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px] text-ink-muted">
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
          title={`Move this line to the ${side === 'offer' ? 'customer' : 'quote'} side`}
        >
          move to {side === 'offer' ? 'ask' : 'quote'}
        </button>
      </div>

      {line.roleUncertain && (
        <p className="mt-1 text-[11px] text-drift no-print">
          Sender disagrees with this side — worth checking.
        </p>
      )}
    </div>
  )
}
