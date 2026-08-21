import { useEffect, useMemo, useRef, useState } from 'react'
import type { CustomerRecord, ExtractedCustomer, PriceMatch, Quote } from '@shared/schema'
import { amountInWords, computeTotals, formatPaise, pad2, parseRupeesToPaise } from '@shared/money'
import { formatDateLong, fromISODate } from '@shared/fy'
import { INDIAN_STATES, taxModeForState } from '@shared/states'
import { apiDownload, apiPost, useApi } from '../lib/api'
import Callout from '../components/Callout'
import CoveringEmail from '../components/CoveringEmail'
import CustomerField from '../components/CustomerField'
import DocumentPreview, { type DocumentData } from '../components/DocumentPreview'
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
  /** Blank warranty is the ordinary case, and prints no term 5 — see TermsSchema. */
  terms: { payment: string; delivery: string; prices: string; validity: string; warranty: string }
  /** Set when this draft is a revision of an existing quote — keeps its ref (§10). */
  reviseOf?: string
  /** The ref being revised, for display only. */
  reviseOfRef?: string
}

interface Props {
  draft: QuoteDraft
  onDraftChange: (draft: QuoteDraft) => void
  sourceThread: string
  /** Lines with content that the parser could not turn into a product. */
  skipped?: string[]
  /** Judgements the parser cannot make — e.g. the prices may be superseded. */
  warnings?: string[]
  /** The thread has been edited since these lines were read from it. */
  stale?: boolean
  /** Customer details Claude read from the thread, offered per field. */
  /** Set once this quotation has a reference; unlocks the downloads. */
  saved: Quote | null
  onSaved: (quote: Quote) => void
  onRevise: () => void
  onStartNew: () => void
  onBack: () => void
}

/** Screen 3 — the quotation itself. */
export default function QuoteEditor({
  draft,
  onDraftChange,
  sourceThread,
  skipped = [],
  warnings = [],
  stale = false,
  saved,
  onSaved,
  onRevise,
  onStartNew,
  onBack,
}: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextSeq, setNextSeq] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'help' | 'problem'; text: string } | null>(null)
  const [status, setStatus] = useState<Quote['status']>(saved?.status ?? 'draft')
  /** Name of the stored customer whose details were filled in, for attribution. */
  const [filledFrom, setFilledFrom] = useState<string | null>(null)
  /** What we last quoted each line for, by line key. */
  const [priceHistory, setPriceHistory] = useState<Record<string, PriceMatch[]>>({})
  const dragFrom = useRef<number | null>(null)

  const health = useApi<{ checks: Record<string, { ok: boolean; detail: string }> }>('/api/health')
  const capabilities = useApi<{ draftEmail: boolean }>('/api/capabilities')
  const aiAvailable = capabilities.data?.draftEmail ?? false
  const pdfReady = health.data?.checks.pdf?.ok ?? false
  const pdfDetail = health.data?.checks.pdf?.detail ?? ''

  /**
   * The document, rebuilt from the form on every keystroke. This is the whole
   * reason the two screens are one: a change to a rate or a line order shows up
   * in the quotation as you make it, not after a save and a page change.
   */
  const preview: DocumentData = {
    ref: saved?.ref ?? '',
    revision: saved?.revision ?? 0,
    date: draft.date,
    customer: {
      name: draft.customer.name,
      address: draft.customer.address,
      attention: draft.customer.attention,
      gstin: draft.customer.gstin,
    },
    contact: draft.contact,
    email: draft.email,
    signatory: draft.signatory,
    items: draft.items.map((i) => ({ desc: i.desc, make: i.make, qty: i.qty, rate: i.rate })),
    tax: draft.tax,
    terms: draft.terms,
  }

  async function download(kind: 'docx' | 'pdf') {
    if (!saved) return
    setBusy(kind)
    setMessage(null)
    try {
      await apiDownload(`/api/render/${kind}`, { quoteId: saved.id })
    } catch (err) {
      setMessage({ tone: 'problem', text: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  async function setQuoteStatus(next: Quote['status']) {
    if (!saved) return
    setStatus(next)
    await apiPost(`/api/quotes/${saved.id}/status`, { status: next }).catch(() =>
      setMessage({ tone: 'problem', text: 'Could not save that status.' }),
    )
  }

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

  /**
   * One round trip for the whole quotation rather than one per line, refreshed
   * when the set of descriptions changes rather than on every keystroke.
   */
  const descriptionKey = draft.items.map((i) => `${i.desc}\u0000${i.partCode}`).join('\u0001')
  useEffect(() => {
    const lines = draft.items.map((i) => ({ desc: i.desc, partCode: i.partCode }))
    if (lines.every((l) => l.desc.trim() === '')) return
    apiPost<{ matches: PriceMatch[][] }>('/api/price-history', {
      lines,
      ...(saved ? { excludeQuoteId: saved.id } : {}),
    })
      .then((r) => {
        const next: Record<string, PriceMatch[]> = {}
        draft.items.forEach((item, i) => {
          const found = r.matches[i]
          if (found && found.length > 0) next[item.key] = found
        })
        setPriceHistory(next)
      })
      .catch(() => setPriceHistory({}))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptionKey, saved?.id])

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
        purpose="These lines came straight from the thread. Check every one against what the customer actually asked for, then save. The reference number is taken at the moment you save, not before."
        right={
          saved ? (
            <span className="label no-print">
              saved as <span className="ref text-ink">{saved.ref}</span>
              {saved.revision > 0 && ` (Rev ${saved.revision})`}
            </span>
          ) : draft.reviseOf ? (
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

      {stale && (
        <Callout tone="problem" label="Out of date" className="mb-3">
          The thread has been edited since these lines were read from it. Go back and read it again
          before saving.
        </Callout>
      )}

      {warnings.map((warning, i) => (
        <Callout key={i} tone="problem" label="Check this" className="mb-3">
          {warning}
        </Callout>
      ))}

      {skipped.length > 0 && (
        <details className="mb-3 border border-drift-rule bg-drift-bg text-[12.5px] text-drift no-print">
          <summary className="cursor-pointer px-3 py-2">
            <span className="label mr-2 text-drift">not read</span>
            {skipped.length} line{skipped.length === 1 ? '' : 's'} in the thread produced no
            product. Open this and check none of them was something the customer asked for.
          </summary>
          <ul className="border-t border-dashed border-drift-rule px-3 py-2">
            {skipped.map((line, i) => (
              <li key={i} className="truncate py-0.5 font-mono text-[12px]">
                {line}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Form on the left, the quotation itself on the right, updating as you
          type. Stacks on a narrow screen so nothing is cut off. */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,600px)]">
        <div className="min-w-0">

      {/* Says the convention once, rather than leaving it to be discovered by
          clicking things to see which ones respond. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-ink-muted no-print">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-7 border border-rule bg-paper-raised" />
          you can type here
        </span>
        <span className="flex items-center gap-1.5">
          <span className="calc inline-block h-3.5 w-7" />
          worked out for you — not editable
        </span>
      </div>

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
          <CustomerField
            value={draft.customer.name}
            onChange={(name) => {
              setFilledFrom(null)
              set({ customer: { ...draft.customer, name } })
            }}
            onPick={(customer) => {
              // One click instead of six fields — and the GSTIN can no longer
              // be retyped wrong.
              setFilledFrom(customer.name)
              onDraftChange({
                ...draft,
                customer: {
                  name: customer.name,
                  address: customer.address,
                  attention: customer.attention,
                  gstin: customer.gstin,
                  state: customer.state,
                },
                contact: customer.contact || draft.contact,
                email: customer.email || draft.email,
                tax: { ...draft.tax, mode: taxModeForState(customer.state) },
              })
            }}
            className={inputClass}
          />
          {filledFrom && (
            <p className="mt-1 text-[11px] text-ink-faint">
              filled from your customer list · edit anything and the change is remembered on save
            </p>
          )}
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
          boxed cells are editable · drag a row, or use ↑ ↓, to reorder
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
              <th className="label w-28 px-2 py-2 text-right">
                Amount
                <span className="ml-1 font-normal normal-case tracking-normal text-ink-faint">
                  (calculated)
                </span>
              </th>
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
                <td
                  className="num calc px-2 py-2 align-top"
                  title="Line number — set by the order of the rows"
                >
                  {pad2(index + 1)}
                </td>
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
                  {/* What we last charged for this. Informational, so ink-muted
                      rather than amber — §9 reserves amber for "look here", and
                      a past price is not a problem. Clicking fills it; nothing
                      fills itself, because a stale price applied silently is
                      the failure this application exists to catch. */}
                  {priceHistory[item.key]?.map((match) => (
                    <button
                      key={`${match.ref}-${match.ratePaise}`}
                      type="button"
                      onClick={() =>
                        setItem(index, {
                          rate: match.ratePaise,
                          rateText: formatPaise(match.ratePaise),
                        })
                      }
                      title={`Fill ${formatPaise(match.ratePaise)} — ${match.description}`}
                      className="mt-0.5 block w-full text-right text-[10px] leading-tight
                                 text-ink-faint hover:text-accent hover:underline no-print"
                    >
                      last {formatPaise(match.ratePaise)} · {match.customerName.split(/\s+/)[0]} ·{' '}
                      {match.date}
                    </button>
                  ))}
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
                <td
                  className="num calc px-2 py-2 align-top"
                  title="Calculated — rate x quantity"
                >
                  {formatPaise(item.qty * item.rate)}
                </td>
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
      <div className="mb-1.5 flex items-baseline justify-between">
        <h3 className="label">Terms and totals</h3>
        <span className="text-[11px] text-ink-faint no-print">
          terms are editable · totals are calculated from the lines above
        </span>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-4">
        <div className="panel p-4">
          <h3 className="label mb-2">Terms and conditions</h3>
          <div className="space-y-2">
            <TermRow label="Payment Terms" value={draft.terms.payment} onChange={(payment) => set({ terms: { ...draft.terms, payment } })} />
            <TermRow label="Delivery" value={draft.terms.delivery} onChange={(delivery) => set({ terms: { ...draft.terms, delivery } })} />
            <TermRow label="Prices" value={draft.terms.prices} onChange={(prices) => set({ terms: { ...draft.terms, prices } })} />
            <TermRow label="Validity" value={draft.terms.validity} onChange={(validity) => set({ terms: { ...draft.terms, validity } })} />
            <TermRow label="Warranty" value={draft.terms.warranty} onChange={(warranty) => set({ terms: { ...draft.terms, warranty } })} />
          </div>
          {/* The four above always print, so only this one needs saying: empty
              is a real answer here, and the desk can still promise a warranty
              the lines never mentioned. */}
          <p className="mt-2 text-[11px] text-ink-faint no-print">
            term 5 prints on every document — leave it blank only to print the label with nothing after it
          </p>
        </div>

        <div className="panel p-4">
          <table className="w-full text-[13px]">
            <tbody>
              <tr>
                <td className="py-1">Sub Total</td>
                <td className="num calc py-1 pr-2">{formatPaise(totals.sub)}</td>
              </tr>
              {totals.taxRows.map((row) => (
                <tr key={row.label}>
                  <td className="py-1">{row.label}</td>
                  <td className="num calc py-1 pr-2">{formatPaise(row.paise)}</td>
                </tr>
              ))}
              <tr className="border-t border-rule-strong">
                <td className="py-1.5 font-semibold">Total Amount</td>
                <td className="num calc py-1.5 pr-2 font-semibold text-ink">
                  {formatPaise(totals.total)}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 border-t border-rule pt-2 text-[12px] text-ink-muted">
            {amountInWords(totals.total)}
          </p>
        </div>
      </div>

        </div>

        {/* The document. Sticky, so it stays in view while the form scrolls. */}
        <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">
          <div className="mb-1.5 flex items-baseline justify-between">
            <h3 className="label">Document</h3>
            <span className="text-[11px] text-ink-faint no-print">
              {saved ? 'saved — downloads below' : 'updates as you type · save to download'}
            </span>
          </div>

          <DocumentPreview
            data={preview}
            pendingRef={`NCS/…/${draft.initials.toUpperCase()}/${
              nextSeq === null ? '???' : String(nextSeq).padStart(3, '0')
            }`}
          />

          <div className="mt-3 flex flex-wrap items-center gap-2 no-print">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => download('docx')}
              disabled={!saved || busy !== null}
              title={saved ? 'The editable Word file, on the letterhead' : 'Save it first'}
            >
              {busy === 'docx' ? 'Building…' : 'Download Word'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => download('pdf')}
              disabled={!saved || busy !== null || !pdfReady}
              title={!saved ? 'Save it first' : pdfReady ? 'Converted from the same Word file' : pdfDetail}
            >
              {busy === 'pdf' ? 'Converting…' : 'Download PDF'}
            </button>

            {saved && (
              <>
                <span className="grow" />
                <span className="label">Status</span>
                <select
                  value={status}
                  onChange={(e) => setQuoteStatus(e.target.value as Quote['status'])}
                  className="border border-rule bg-paper-raised px-2 py-1 text-[12px]"
                >
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                </select>
              </>
            )}
          </div>

          {saved && (
            <div className="mt-2 flex flex-wrap gap-2 no-print">
              <button type="button" className="btn px-2 py-0.5 text-[12px]" onClick={onRevise}>
                Revise
              </button>
              <button type="button" className="btn px-2 py-0.5 text-[12px]" onClick={onStartNew}>
                New quotation
              </button>
            </div>
          )}

          {!pdfReady && health.data && (
            <Callout className="mt-2 no-print" label="PDF is off">
              {pdfDetail} The Word download is unaffected — open it and save as PDF from there.
            </Callout>
          )}

          {saved && (
            <CoveringEmail quoteId={saved.id} available={health.data !== null && aiAvailable} />
          )}

          {message && (
            <Callout
              tone={message.tone}
              label={message.tone === 'problem' ? 'Problem' : undefined}
              className="mt-2 no-print"
            >
              {message.text}
            </Callout>
          )}
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
          Back to thread
        </button>
        <span className="grow" />
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={saving || blockers.length > 0}
          title={
            saved
              ? 'This already has a reference — saving again takes a new one'
              : 'Takes the next reference number in the series'
          }
        >
          {saving
            ? 'Saving…'
            : saved
              ? 'Save again as a new quotation'
              : 'Save and take a reference'}
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

// Both defined in index.css, so the "boxed = editable" convention is stated in
// one place. The cells used to be `border-transparent bg-transparent`, visible
// only on hover — which made an editable description and a calculated amount
// look exactly the same.
const inputClass = 'field'
const cellClass = 'field-cell'

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
