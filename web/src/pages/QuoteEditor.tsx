import { useEffect, useMemo, useRef, useState } from 'react'
import type { Quote, ReconciledPair } from '@shared/schema'
import { amountInWords, computeTotals, formatPaise, pad2, parseRupeesToPaise } from '@shared/money'
import { formatDateLong, fromISODate } from '@shared/fy'
import { INDIAN_STATES, taxModeForState } from '@shared/states'
import { apiPost } from '../lib/api'
import Callout from '../components/Callout'
import ScreenHeader from '../components/ScreenHeader'

export interface EditorItem {
  key: string
  desc: string
  make: string
  partCode: string
  hsn: string
  qty: number
  rate: number
  /** Kept separately so a half-typed "1250." does not fight the parser. */
  rateText: string
}

export interface QuoteDraft {
  date: string
  initials: string
  customer: { name: string; address: string; attention: string; gstin: string; state: string }
  contact: string
  email: string
  signatory: string
  items: EditorItem[]
  tax: { mode: 'IGST' | 'CGST+SGST'; rate: number }
  terms: { payment: string; delivery: string; prices: string; validity: string }
  /** Set when this draft is a revision of an existing quote — keeps its ref (§10). */
  reviseOf?: string
  /** The ref being revised, for display only. */
  reviseOfRef?: string
}

interface Props {
  draft: QuoteDraft
  onDraftChange: (draft: QuoteDraft) => void
  sourceThread: string
  reconciliation: ReconciledPair[]
  onSaved: (quote: Quote) => void
  onBack: () => void
}

/** Screen 3 — the quotation itself. */
export default function QuoteEditor({
  draft,
  onDraftChange,
  sourceThread,
  reconciliation,
  onSaved,
  onBack,
}: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextSeq, setNextSeq] = useState<number | null>(null)
  const dragFrom = useRef<number | null>(null)

  const totals = useMemo(
    () => computeTotals(draft.items, draft.tax.mode, draft.tax.rate),
    [draft.items, draft.tax.mode, draft.tax.rate],
  )

  // §7 — a preview only. The number is not taken until Save.
  useEffect(() => {
    const params = new URLSearchParams({ initials: draft.initials, date: draft.date })
    fetch(`/api/next-ref?${params}`)
      .then((r) => r.json())
      .then((d: { nextSeq: number }) => setNextSeq(d.nextSeq))
      .catch(() => setNextSeq(null))
  }, [draft.initials, draft.date])

  /** What is stopping this being saved, in words rather than a greyed-out button. */
  const blockers = useMemo(() => {
    const problems: string[] = []
    if (draft.customer.name.trim() === '') problems.push('The customer needs a name')
    if (draft.items.length === 0) problems.push('A quotation needs at least one line')
    if (draft.items.some((i) => i.desc.trim() === '')) problems.push('Every line needs a description')
    if (draft.initials.trim() === '') problems.push('Initials are needed to allocate a reference')
    return problems
  }, [draft.customer.name, draft.items, draft.initials])

  const unpriced = draft.items.filter((i) => i.rate === 0).length

  const set = (patch: Partial<QuoteDraft>) => onDraftChange({ ...draft, ...patch })

  const setItem = (index: number, patch: Partial<EditorItem>) =>
    set({ items: draft.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) })

  const move = (from: number, to: number) => {
    if (to < 0 || to >= draft.items.length || from === to) return
    const items = [...draft.items]
    const [moved] = items.splice(from, 1)
    items.splice(to, 0, moved!)
    set({ items })
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const quote = await apiPost<Quote>('/api/quote', {
        date: draft.date,
        initials: draft.initials,
        customer: {
          name: draft.customer.name,
          address: draft.customer.address,
          attention: draft.customer.attention,
          ...(draft.customer.gstin ? { gstin: draft.customer.gstin } : {}),
          ...(draft.customer.state ? { state: draft.customer.state } : {}),
        },
        contact: draft.contact,
        email: draft.email,
        signatory: draft.signatory,
        items: draft.items.map((i) => ({
          desc: i.desc,
          make: i.make,
          partCode: i.partCode,
          ...(i.hsn ? { hsn: i.hsn } : {}),
          qty: i.qty,
          rate: i.rate,
        })),
        tax: draft.tax,
        terms: draft.terms,
        sourceThread,
        reconciliation,
        ...(draft.reviseOf ? { reviseOf: draft.reviseOf } : {}),
      })
      onSaved(quote)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <ScreenHeader
        step={3}
        title="Quotation"
        purpose="Fill in who it is for, check the lines, and save. The reference number is taken at the moment you save — not before — so leaving this page costs nothing."
        right={
          draft.reviseOf ? (
            <span className="label no-print">
              revision of <span className="ref text-ink">{draft.reviseOfRef}</span>
              <span className="mx-1.5 text-rule-strong">·</span>
              keeps its reference
            </span>
          ) : (
            <span className="label no-print">
              will become{' '}
              <span className="ref text-ink">
                NCS/…/{draft.initials.toUpperCase()}/
                {nextSeq === null ? '???' : String(nextSeq).padStart(3, '0')}
              </span>
            </span>
          )
        }
      />

      {/* --- header fields --- */}
      <h3 className="label mb-1.5">Who it is for</h3>
      <div className="panel mb-4 grid grid-cols-3 gap-x-5 gap-y-3 p-4">
        <Field label="Date">
          <input
            type="date"
            value={draft.date}
            onChange={(e) => set({ date: e.target.value })}
            className={inputClass}
          />
          <p className="mt-1 text-[11px] text-ink-faint">
            prints as {formatDateLong(fromISODate(draft.date))}
          </p>
        </Field>

        <Field label="Salesperson initials">
          <input
            value={draft.initials}
            onChange={(e) => set({ initials: e.target.value.toUpperCase().slice(0, 4) })}
            className={`${inputClass} font-mono uppercase`}
          />
        </Field>

        <Field label="Signatory">
          <input
            value={draft.signatory}
            onChange={(e) => set({ signatory: e.target.value })}
            className={inputClass}
          />
        </Field>

        <Field label="Customer" span={2}>
          <input
            value={draft.customer.name}
            onChange={(e) => set({ customer: { ...draft.customer, name: e.target.value } })}
            className={inputClass}
          />
        </Field>

        <Field label="Kind attention">
          <input
            value={draft.customer.attention}
            onChange={(e) => set({ customer: { ...draft.customer, attention: e.target.value } })}
            className={inputClass}
          />
        </Field>

        <Field label="Address" span={2}>
          <textarea
            value={draft.customer.address}
            onChange={(e) => set({ customer: { ...draft.customer, address: e.target.value } })}
            rows={2}
            className={`${inputClass} resize-y`}
          />
        </Field>

        <div className="space-y-3">
          <Field label="Ship-to state">
            <select
              value={draft.customer.state}
              onChange={(e) => {
                const state = e.target.value
                set({
                  customer: { ...draft.customer, state },
                  tax: { ...draft.tax, mode: taxModeForState(state) },
                })
              }}
              className={inputClass}
            >
              <option value="">—</option>
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>

          <Field label="GSTIN">
            <input
              value={draft.customer.gstin}
              onChange={(e) => set({ customer: { ...draft.customer, gstin: e.target.value } })}
              className={`${inputClass} font-mono`}
            />
          </Field>
        </div>

        <Field label="Our contact number">
          <input
            value={draft.contact}
            onChange={(e) => set({ contact: e.target.value })}
            className={`${inputClass} font-mono`}
          />
        </Field>

        <Field label="Our email">
          <input
            value={draft.email}
            onChange={(e) => set({ email: e.target.value })}
            className={inputClass}
          />
        </Field>

        <Field label="Tax">
          <div className="flex items-center gap-2">
            <select
              value={draft.tax.mode}
              onChange={(e) =>
                set({ tax: { ...draft.tax, mode: e.target.value as 'IGST' | 'CGST+SGST' } })
              }
              className={inputClass}
            >
              <option value="IGST">IGST (one row)</option>
              <option value="CGST+SGST">CGST + SGST (two rows)</option>
            </select>
            <input
              type="number"
              value={draft.tax.rate}
              onChange={(e) => set({ tax: { ...draft.tax, rate: Number(e.target.value) } })}
              className={`${inputClass} w-16 text-right font-mono`}
            />
            <span className="text-ink-muted">%</span>
          </div>
          <p className="mt-1 text-[11px] text-ink-faint">
            defaulted from the ship-to state — override freely
          </p>
        </Field>
      </div>

      {/* --- items --- */}
      <div className="mb-1.5 flex items-baseline justify-between">
        <h3 className="label">
          Lines <span className="ml-1 text-ink-faint">({draft.items.length})</span>
        </h3>
        <span className="text-[11px] text-ink-faint no-print">
          click any cell to edit · drag a row, or use ↑ ↓, to reorder
        </span>
      </div>
      <div className="panel mb-4">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-rule-strong bg-paper-sunk text-left">
              <th className="label w-10 px-2 py-2">Sr</th>
              <th className="label px-2 py-2">Product name and description</th>
              <th className="label w-28 px-2 py-2">Make</th>
              <th className="label w-28 px-2 py-2">Part code</th>
              <th className="label w-28 px-2 py-2 text-right">Rate</th>
              <th className="label w-16 px-2 py-2 text-right">Qty</th>
              <th className="label w-28 px-2 py-2 text-right">Amount</th>
              <th className="w-20 px-2 py-2 no-print" />
            </tr>
          </thead>
          <tbody>
            {draft.items.map((item, index) => (
              <tr
                key={item.key}
                draggable
                onDragStart={() => (dragFrom.current = index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragFrom.current !== null) move(dragFrom.current, index)
                  dragFrom.current = null
                }}
                className="border-b border-rule last:border-b-0 hover:bg-paper-sunk/40"
              >
                <td className="num px-2 py-1 align-top text-ink-faint">{pad2(index + 1)}</td>
                <td className="px-1 py-1 align-top">
                  <textarea
                    value={item.desc}
                    rows={1}
                    onChange={(e) => setItem(index, { desc: e.target.value })}
                    className={`${cellClass} resize-y`}
                  />
                </td>
                <td className="px-1 py-1 align-top">
                  <input
                    value={item.make}
                    onChange={(e) => setItem(index, { make: e.target.value })}
                    className={cellClass}
                  />
                </td>
                <td className="px-1 py-1 align-top">
                  <input
                    value={item.partCode}
                    onChange={(e) => setItem(index, { partCode: e.target.value })}
                    className={`${cellClass} font-mono`}
                  />
                </td>
                <td className="px-1 py-1 align-top">
                  <input
                    value={item.rateText}
                    onChange={(e) => {
                      const rateText = e.target.value
                      const parsed = parseRupeesToPaise(rateText)
                      setItem(index, { rateText, ...(parsed !== null ? { rate: parsed } : {}) })
                    }}
                    onBlur={() => setItem(index, { rateText: formatPaise(item.rate) })}
                    className={`${cellClass} num`}
                  />
                </td>
                <td className="px-1 py-1 align-top">
                  <input
                    type="number"
                    min={0}
                    value={item.qty}
                    onChange={(e) => setItem(index, { qty: Math.max(0, Number(e.target.value)) })}
                    className={`${cellClass} num`}
                  />
                </td>
                <td className="num px-2 py-2 align-top">{formatPaise(item.qty * item.rate)}</td>
                <td className="px-1 py-1 align-top no-print">
                  <div className="flex gap-0.5">
                    <IconBtn label="Move up" onClick={() => move(index, index - 1)}>↑</IconBtn>
                    <IconBtn label="Move down" onClick={() => move(index, index + 1)}>↓</IconBtn>
                    <IconBtn
                      label="Delete line"
                      onClick={() => set({ items: draft.items.filter((_, i) => i !== index) })}
                    >
                      ×
                    </IconBtn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="border-t border-rule px-2 py-2 no-print">
          <button
            type="button"
            className="btn"
            onClick={() =>
              set({
                items: [
                  ...draft.items,
                  {
                    key: crypto.randomUUID(),
                    desc: '',
                    make: '',
                    partCode: '',
                    hsn: '',
                    qty: 1,
                    rate: 0,
                    rateText: '0.00',
                  },
                ],
              })
            }
          >
            Add line
          </button>
        </div>
      </div>

      {/* --- totals + terms --- */}
      <h3 className="label mb-1.5">Terms and totals</h3>
      <div className="mb-4 grid grid-cols-2 gap-4">
        <div className="panel p-4">
          <h3 className="label mb-2">Terms and conditions</h3>
          <div className="space-y-2">
            <TermRow label="Payment Terms" value={draft.terms.payment} onChange={(payment) => set({ terms: { ...draft.terms, payment } })} />
            <TermRow label="Delivery" value={draft.terms.delivery} onChange={(delivery) => set({ terms: { ...draft.terms, delivery } })} />
            <TermRow label="Prices" value={draft.terms.prices} onChange={(prices) => set({ terms: { ...draft.terms, prices } })} />
            <TermRow label="Validity" value={draft.terms.validity} onChange={(validity) => set({ terms: { ...draft.terms, validity } })} />
          </div>
        </div>

        <div className="panel p-4">
          <table className="w-full text-[13px]">
            <tbody>
              <tr>
                <td className="py-1">Sub Total</td>
                <td className="num py-1">{formatPaise(totals.sub)}</td>
              </tr>
              {totals.taxRows.map((row) => (
                <tr key={row.label}>
                  <td className="py-1">{row.label}</td>
                  <td className="num py-1">{formatPaise(row.paise)}</td>
                </tr>
              ))}
              <tr className="border-t border-rule-strong">
                <td className="py-1.5 font-semibold">Total Amount</td>
                <td className="num py-1.5 font-semibold">{formatPaise(totals.total)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 border-t border-rule pt-2 text-[12px] text-ink-muted">
            {amountInWords(totals.total)}
          </p>
        </div>
      </div>

      {/* Say what is missing, rather than disabling the button and leaving the
          reader to work out why. */}
      {blockers.length > 0 && (
        <Callout className="mb-3" label="Before saving">
          {blockers.join(' · ')}
        </Callout>
      )}

      {unpriced > 0 && blockers.length === 0 && (
        <Callout className="mb-3" label="Worth checking">
          {unpriced} {unpriced === 1 ? 'line has' : 'lines have'} no rate. That is usually a line the
          customer asked for that we have not priced yet — it will print as 0.00.
        </Callout>
      )}

      <div className="flex items-center gap-2 no-print">
        <button type="button" className="btn" onClick={onBack}>
          Back to ask vs quote
        </button>
        <span className="grow" />
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={saving || blockers.length > 0}
        >
          {saving ? 'Saving…' : 'Save and take a reference'}
        </button>
      </div>

      {error && (
        <Callout tone="problem" label="Problem" className="mt-3">
          {error}
        </Callout>
      )}
    </div>
  )
}

const inputClass =
  'w-full border border-rule bg-paper-raised px-2 py-1 text-[13px] focus:border-accent'
const cellClass =
  'w-full border border-transparent bg-transparent px-1 py-1 text-[13px] hover:border-rule focus:border-accent focus:bg-paper-raised'

function Field({
  label,
  children,
  span = 1,
}: {
  label: string
  children: React.ReactNode
  span?: number
}) {
  return (
    <div style={{ gridColumn: `span ${span}` }}>
      <label className="label mb-1 block">{label}</label>
      {children}
    </div>
  )
}

function TermRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="label w-28 shrink-0">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
    </div>
  )
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="border border-rule px-1.5 leading-5 text-ink-muted hover:bg-paper-sunk"
    >
      {children}
    </button>
  )
}
