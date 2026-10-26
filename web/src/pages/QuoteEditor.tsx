import { useEffect, useMemo, useRef, useState } from 'react'
import type { CustomerCandidate, CustomerRecord, PriceMatch, Quote } from '@shared/schema'
import { amountInWords, computeTotals, formatPaise, pad2, parseRupeesToPaise } from '@shared/money'
import { formatDateLong, fromISODate } from '@shared/fy'
import { INDIAN_STATES } from '@shared/states'
import { GST_RATE_PERCENT, SALESPEOPLE } from '@shared/company'
import { apiDownload, ApiError, apiPost, apiPut, useApi } from '../lib/api'
import { newRowKey } from '../lib/rowKey'
import Callout from '../components/Callout'
import CoveringEmail from '../components/CoveringEmail'
import CustomerField from '../components/CustomerField'
import CustomerChooser from '../components/CustomerChooser'
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
  /**
   * WHICH ledger on the customer master this quotation is for.
   *
   * Null means none has been chosen. That is a legitimate finished state — a
   * company quoted before Tally has it — but it is NOT legitimate while
   * `customerCandidates` below is non-empty, and the save is blocked until one
   * of them is picked or the desk says none of them is right.
   *
   * `customer.name` is only the text that prints. It cannot serve as identity
   * on a list holding seventeen ledgers that answer to "Morgan Stanley".
   */
  customerId: string | null
  /**
   * The desk was shown the matching ledgers and said none of them is right.
   *
   * Distinct from `customerId: null`, which merely means unanswered — the
   * server can tell the two apart and only lets this one through.
   */
  customerOffList?: boolean
  /**
   * Ledgers the thread might have meant, from the AI read. Non-empty means
   * nothing was filled in and the chooser is on screen.
   */
  customerCandidates?: CustomerCandidate[]
  contact: string
  email: string
  signatory: string
  /**
   * The closing line's numbers, which are the salesperson's and not the
   * company's. Set by the Prepared by picker along with the other three, and
   * editable like them.
   */
  queriesNumbers: string
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
  /**
   * The number this quotation will take: the server's peek until the desk types
   * over it, theirs from then on.
   */
  const [seq, setSeq] = useState<number | null>(null)
  /** Kept separately so a half-deleted "04" does not fight the parser, as rates are. */
  const [seqText, setSeqText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'help' | 'problem'; text: string } | null>(null)
  const [status, setStatus] = useState<Quote['status']>(saved?.status ?? 'draft')
  /** Name of the stored customer whose details were filled in, for attribution. */
  const [filledFrom, setFilledFrom] = useState<string | null>(null)
  /** What we last quoted each line for, by line key. */
  const [priceHistory, setPriceHistory] = useState<Record<string, PriceMatch[]>>({})
  const dragFrom = useRef<number | null>(null)
  /**
   * Set the moment the desk types in the reference box. The peek runs again
   * whenever the date or the initials change, and it must not take their number
   * back on its way past.
   */
  const seqIsTheirs = useRef(false)

  const health = useApi<{ checks: Record<string, { ok: boolean; detail: string }> }>('/api/health')
  const capabilities = useApi<{ draftEmail: boolean }>('/api/capabilities')
  const aiAvailable = capabilities.data?.draftEmail ?? false
  const pdfReady = health.data?.checks.pdf?.ok ?? false
  const pdfDetail = health.data?.checks.pdf?.detail ?? ''

  /** The reference the page shows and the number the save claims — see chooseRef. */
  const refChoice = chooseRef(draft.initials, seq, nextSeq)
  /**
   * A saved quotation's reference is already on a document and a revision
   * carries its parent's (§10), so neither leaves a number here to be chosen.
   */
  const seqOverride = saved || draft.reviseOf ? undefined : refChoice.seqOverride

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
    queriesNumbers: draft.queriesNumbers,
    items: draft.items.map((i) => ({ desc: i.desc, make: i.make, qty: i.qty, rate: i.rate })),
    tax: draft.tax,
    terms: draft.terms,
  }

  /**
   * Where this screen has got to that the saved record has not.
   *
   * The two are rendered from different things: the document above comes from
   * the draft, the download comes from the stored row — /api/render takes a
   * quoteId and loads it. So every edit made after a save lived on screen alone.
   * Switch a Maharashtra quotation to one GST row and the preview follows; the
   * PDF still prints CGST 9% and SGST 9%, because that is what the record says.
   *
   * Recomputed on every keystroke rather than memoised: it is a walk of one
   * quotation's fields, and a stale answer here is the bug it exists to catch.
   */
  const changes = documentChanges(draft, saved)
  /**
   * A quotation that is no longer a draft is fixed. A document has gone out and
   * the record behind it is our only account of what the customer was sent, so
   * the update route refuses it with a 409 — and this screen does not ask for
   * one it knows will be refused. It offers a revision instead.
   */
  const fixed = saved !== null && status !== 'draft'
  /** Set when pressing a download will WRITE before it renders — so the button says so. */
  const willWrite = changes.length > 0 && !fixed
  /**
   * The quotation by name, written the way the header and the server's own
   * refusals write it. A bare reference names three documents once a quotation
   * has been revised twice.
   */
  const savedName = saved
    ? saved.revision > 0
      ? `${saved.ref} Rev ${saved.revision}`
      : saved.ref
    : ''

  /**
   * The quotation as the server takes it, built once for both routes that take
   * it.
   *
   * A save adds the initials and the number on top of this; an edit is
   * forbidden to send either, because the reference is the one thing it is
   * keeping. Sharing the body is the whole point — a field added to the form
   * has to reach the record whichever button writes it, and two literals would
   * eventually disagree about which fields those are.
   */
  function documentBody() {
    return {
      date: draft.date,
      customer: {
        name: draft.customer.name,
        address: draft.customer.address,
        attention: draft.customer.attention,
        ...(draft.customer.gstin ? { gstin: draft.customer.gstin } : {}),
        ...(draft.customer.state ? { state: draft.customer.state } : {}),
      },
      ...(draft.customerId !== null ? { customerId: draft.customerId } : {}),
      ...(draft.customerId === null && draft.customerOffList === true
        ? { customerOffList: true }
        : {}),
      contact: draft.contact,
      email: draft.email,
      signatory: draft.signatory,
      queriesNumbers: draft.queriesNumbers,
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
    }
  }

  /**
   * Write this screen over the row it was saved as, keeping its reference.
   *
   * Until this existed the only way to make the file agree with the screen was
   * to save again, which allocates a new number — the desk paid a reference for
   * a corrected address. PUT rewrites the same row, so the ref, the revision and
   * the date it was created stay as they are.
   *
   * What comes back is the row read back from the database, not the request
   * echoed, and that is what `saved` becomes: this screen exists because a
   * screen and a record disagreed, so it takes the record's word for it.
   */
  async function persist(): Promise<Quote> {
    if (!saved) throw new Error('There is nothing saved to write these changes to.')
    const updated = await apiPut<Quote>(`/api/quotes/${saved.id}`, documentBody())
    onSaved(updated)
    return updated
  }

  async function download(kind: 'docx' | 'pdf') {
    if (!saved) return
    setBusy(kind)
    setMessage(null)
    try {
      await downloadCurrent({
        // A fixed quotation is downloaded as it stands. The callout above these
        // buttons says so in words, and a PUT here would only come back 409.
        changed: willWrite,
        persist,
        render: () => apiDownload(`/api/render/${kind}`, { quoteId: saved.id }),
      })
    } catch (err) {
      // The server's own sentence — the field a 400 names, the status a 409
      // names — reaching the desk exactly as a save error already does. A
      // download WRITES first when the screen has moved on, so it can be
      // refused for not naming a customer too, and it puts up the same chooser.
      setMessage({ tone: 'problem', text: offerTheChooser(err) ?? (err as Error).message })
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
      .then((d: { nextSeq: number }) => {
        setNextSeq(d.nextSeq)
        // Fills the box, and never refills it: a number the desk typed is
        // theirs, and this runs again every time the date or the initials move.
        if (!seqIsTheirs.current) {
          setSeq(d.nextSeq)
          setSeqText(pad3(d.nextSeq))
        }
      })
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
    /**
     * The rule this whole screen turns on: a read that found several possible
     * ledgers has filled nothing in, and a quotation cannot be completed until
     * a person says which company it is for. The server refuses this too — see
     * requireCustomerChoice — because a greyed-out button is a suggestion and
     * this is not one.
     */
    if ((draft.customerCandidates?.length ?? 0) > 0) {
      problems.push('Choose which customer this quotation is for')
    }
    if (draft.items.length === 0) problems.push('A quotation needs at least one line')
    if (draft.items.some((i) => i.desc.trim() === '')) problems.push('Every line needs a description')
    if (draft.initials.trim() === '') problems.push('Initials are needed to allocate a reference')
    return problems
  }, [draft.customer.name, draft.customerCandidates, draft.items, draft.initials])

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
        ...documentBody(),
        // The three an edit may not send, because these are the three that
        // decide the reference and a save is where a reference is decided.
        initials: draft.initials,
        ...(draft.reviseOf ? { reviseOf: draft.reviseOf } : {}),
        // Absent unless the desk moved off the number the server offered.
        // Sending the peek back would make every save an override, and the
        // number would stop being taken atomically the moment two saves met.
        ...(seqOverride !== undefined ? { seqOverride } : {}),
      })
      onSaved(quote)
    } catch (err) {
      setError(offerTheChooser(err) ?? (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /**
   * A save refused for not naming a customer puts the chooser back on screen.
   *
   * The case that needs it is ordinary rather than exotic: every quotation
   * saved before 004 has no ledger recorded, so opening one from History and
   * revising it arrives here with nothing read and nothing to choose from. The
   * server sends the candidates with the refusal precisely so this is one
   * click rather than a retyped name.
   */
  function offerTheChooser(err: unknown): string | null {
    if (!(err instanceof ApiError) || err.status !== 409) return null
    const offered = err.body?.customerCandidates
    if (!Array.isArray(offered) || offered.length === 0) return null

    onDraftChange({ ...draft, customerCandidates: offered as CustomerCandidate[] })
    return err.message
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
              will become <span className="ref text-ink">{refChoice.pendingRef}</span>
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

      {/*
        Above the fields, not inside them, and that placement is the argument.
        While this is on screen the five customer boxes below are EMPTY — the
        read deliberately filled nothing in, because the thread named a company
        that answers to several ledgers with different GSTINs and ship-to
        states. Putting the chooser first means the desk reads the question
        before they see the blanks and start typing into them.
      */}
      <CustomerChooser
        candidates={draft.customerCandidates ?? []}
        readName={draft.customer.name}
        onChoose={(candidate) =>
          onDraftChange({
            ...draft,
            customer: candidate.customer,
            customerId: candidate.record.id,
            customerOffList: false,
            customerCandidates: [],
            contact: candidate.record.contact || draft.contact,
            email: candidate.record.email || draft.email,
          })
        }
        onDismiss={() =>
          // Not on the list. The thread's name stays in the box to be typed
          // over, everything else is the desk's to fill, and it is recorded as
          // a new customer on save.
          onDraftChange({
            ...draft,
            customerId: null,
            customerOffList: true,
            customerCandidates: [],
          })
        }
      />

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

        {/*
          ONE CHOICE SETS FIVE FIELDS, because on this document they are not
          five independent facts — they are one person. The initials pick the
          reference series, the name signs it, and the contact number, email and
          closing "call us at" numbers are all theirs. Typed separately they
          drift: a quotation numbered .../LD/ over Rakhi Gupte's direct line is
          a document neither of them can answer the phone for.

          Everything it sets stays editable underneath, so a stand-in signing
          for a colleague is still one field to change rather than a locked box.
        */}
        <Field label="Prepared by">
          <select
            value={
              SALESPEOPLE.find((person) => person.initials === draft.initials)?.initials ?? ''
            }
            onChange={(e) => {
              const person = SALESPEOPLE.find((s) => s.initials === e.target.value)
              if (!person) return
              set({
                initials: person.initials,
                signatory: person.name,
                contact: person.phone,
                email: person.email,
                queriesNumbers: person.queriesNumbers,
              })
            }}
            className={inputClass}
          >
            {/* Only reachable by editing the fields below out of step with each
                other; naming that state beats showing a blank select. */}
            {!SALESPEOPLE.some((person) => person.initials === draft.initials) && (
              <option value="">— {draft.initials || 'no initials'} —</option>
            )}
            {SALESPEOPLE.map((person) => (
              <option key={person.initials} value={person.initials}>
                {person.name} ({person.initials})
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-ink-faint">
            sets the reference series, the signature, and the contact details below
          </p>
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
              /**
               * TYPING OVER THE NAME UN-CHOOSES THE LEDGER, deliberately.
               *
               * Editing a chosen customer's spelling is fine and stays chosen —
               * that is what the id is for. But retyping the name to something
               * else while the id still points at the old ledger would save one
               * company's name against another company's row, and quietly
               * overwrite that row's address and GSTIN on the way. Clearing it
               * means the desk is asked again, which is the correct cost.
               */
              set({
                customer: { ...draft.customer, name },
                customerId: null,
                // A different name is a different question, so a previous
                // "none of these" no longer answers it.
                customerOffList: false,
              })
            }}
            onPick={(customer) => {
              // One click instead of six fields — and the GSTIN can no longer
              // be retyped wrong. Picking here IS a choice, so it clears the
              // chooser as surely as choosing from it does.
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
                customerId: customer.id,
                customerOffList: false,
                customerCandidates: [],
                contact: customer.contact || draft.contact,
                email: customer.email || draft.email,
              })
            }}
            className={inputClass}
          />
          {filledFrom && (
            <p className="mt-1 text-[11px] text-ink-faint">
              filled from your customer list · edit anything and the change is remembered on save
            </p>
          )}
          {/*
            Which ledger this is going against, said out loud. Two ledgers of
            one company are told apart by their address and GSTIN, both of which
            are in boxes further down that nobody re-reads before saving — so
            the fact that a choice was made, and is still in force, belongs
            beside the name it was made for.
          */}
          {draft.customerId !== null && (draft.customerCandidates?.length ?? 0) === 0 && (
            <p className="mt-1 text-[11px] text-accent">
              going to this customer on your list
              {draft.customer.gstin !== '' && ` · ${draft.customer.gstin}`}
            </p>
          )}
          {draft.customerId === null && (draft.customerCandidates?.length ?? 0) === 0 &&
            draft.customer.name.trim() !== '' && (
              <p className="mt-1 text-[11px] text-ink-faint">
                {draft.customerOffList === true
                  ? 'quoting a company that is not on your list · it will be added when you save'
                  : 'not on your customer list · it will be added when you save'}
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
              // The state no longer touches the tax: the document carries one
              // GST 18% row whoever it ships to. It is still stored, and still
              // worth getting right — it is part of the customer's address on
              // file, and the record is what a future tax question is answered
              // from.
              onChange={(e) => set({ customer: { ...draft.customer, state: e.target.value } })}
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

        {/*
          NOT A CONTROL ANY MORE. It was a mode dropdown — IGST as one row
          against CGST + SGST as two — plus an editable rate, defaulted from the
          ship-to state. The desk asked for one constant, and both of the
          documents they supplied as correct carry a single "GST 18%" row
          whatever state the customer ships to, so the choice was offering a way
          to make the document disagree with the letterhead.

          Shown rather than removed, because it is a number on the total and the
          desk should be able to see what is being added without opening the
          document. See the note beside GST_RATE_PERCENT for the one thing to
          know before making it a control again.
        */}
        <Field label="Tax">
          <div className="calc px-2 py-1 font-mono text-[13px]">GST {GST_RATE_PERCENT}%</div>
          <p className="mt-1 text-[11px] text-ink-faint">
            the same on every quotation — the letterhead's own single GST row
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
                    key: newRowKey(),
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
              {!saved
                ? 'updates as you type · save to download'
                : changes.length > 0
                  ? 'changed since it was saved'
                  : 'saved — downloads below'}
            </span>
          </div>

          {/* The reference number is edited in the Ref line of the document
              itself rather than in a field over on the form: it is the value
              you check by looking at the document, so that is where it should
              be changed. Only an unsaved original offers it — a saved one is
              printed on something that may already have gone out, and a
              revision inherits the reference it revises. */}
          <DocumentPreview
            data={preview}
            pendingRef={refChoice.pendingRef}
            editableSeq={
              saved || draft.reviseOf
                ? undefined
                : {
                    value: seqText,
                    onChange: (typed) => {
                      seqIsTheirs.current = true
                      setSeqText(typed)
                      // An empty or half-typed box leaves the last real number
                      // standing, so what the document shows and what the save
                      // claims cannot part company mid-edit.
                      if (/^\d+$/.test(typed.trim()) && Number(typed) >= 1) setSeq(Number(typed))
                    },
                    onBlur: () => setSeqText(seq === null ? '' : pad3(seq)),
                    hint:
                      nextSeq === null
                        ? 'The series could not be read. Left alone, the server takes the next number.'
                        : seqOverride === undefined
                          ? 'The next in the series, taken when you save.'
                          : `Chosen instead of ${pad3(nextSeq)} — refused on save if it is already in use.`,
                  }
            }
          />

          {/* Beside the downloads, because that is where the wrong document used
              to be handed over without a word. Amber: §9 keeps it for drift, and
              a screen and a file that have parted company is exactly that. */}
          {saved && changes.length > 0 && (
            <Callout
              tone="drift"
              label={fixed ? 'Fixed' : 'Only on screen'}
              className="mt-3 no-print"
            >
              {fixed ? (
                <>
                  {savedName} is marked {status}, and a document that has gone out cannot be
                  rewritten — the record behind it is our only account of what the customer was
                  sent. So the downloads below are that document, not this screen. Changed here:{' '}
                  {changeLabels(changes).join(' · ')}. Revise it instead: the button below keeps the
                  reference and takes the next revision number.
                </>
              ) : (
                <>
                  {savedName} still holds the older document, and a download is built from the
                  record rather than from this screen. Changed here:{' '}
                  {changeLabels(changes).join(' · ')}. Downloading writes these changes to{' '}
                  {savedName} first — same reference, same revision, no new number taken.
                </>
              )}
            </Callout>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2 no-print">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => download('docx')}
              disabled={!saved || busy !== null}
              title={
                !saved
                  ? 'Save it first'
                  : willWrite
                    ? `Writes these changes to ${savedName} first, then builds the Word file`
                    : 'The editable Word file, on the letterhead'
              }
            >
              {busy === 'docx'
                ? 'Building…'
                : willWrite
                  ? 'Save changes and download Word'
                  : 'Download Word'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => download('pdf')}
              disabled={!saved || busy !== null || !pdfReady}
              title={
                !saved
                  ? 'Save it first'
                  : !pdfReady
                    ? pdfDetail
                    : willWrite
                      ? `Writes these changes to ${savedName} first, then converts the Word file`
                      : 'Converted from the same Word file'
              }
            >
              {busy === 'pdf'
                ? 'Converting…'
                : willWrite
                  ? 'Save changes and download PDF'
                  : 'Download PDF'}
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
              : seqOverride !== undefined
                ? 'Takes the reference number you chose'
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

function pad3(seq: number): string {
  return String(seq).padStart(3, '0')
}

export interface RefChoice {
  /** The reference as it will read, for the header and the document beside the form. */
  pendingRef: string
  /** What POST /api/quote carries. Absent means "server, take the next one". */
  seqOverride?: number
}

/**
 * The reference shown and the number claimed, decided together.
 *
 * Together because they are one decision. The document beside the form is the
 * document, so a number the desk typed has to reach both the page and the
 * request or neither; worked out separately they drift, and the drift is silent
 * — the screen reads 046 while 047 is saved and the desk hears it from the
 * customer.
 *
 * `peeked` is what GET /api/next-ref says the server would allocate on its own.
 * Matching it means nothing was changed, so nothing is sent and the number is
 * still taken atomically on save (§7). An override sent every time would hand
 * two people the same number the first time two saves overlapped.
 *
 * A null `chosen` — the peek never arrived — prints as ??? rather than as a
 * number nobody chose, and sends nothing, which is the server allocating as it
 * always did.
 */
export function chooseRef(
  initials: string,
  chosen: number | null,
  peeked: number | null,
): RefChoice {
  return {
    pendingRef: `NCS/…/${initials.toUpperCase()}/${chosen === null ? '???' : pad3(chosen)}`,
    ...(chosen !== null && chosen !== peeked ? { seqOverride: chosen } : {}),
  }
}

/**
 * What a stored quotation holds that this screen cannot make differ, each for
 * its own reason.
 *
 * `id`, `ref`, `revision` and `createdAt` are the quotation's identity and the
 * update route refuses to write them — they are printed on a document that may
 * already be with a customer. `status` moves only through the Status box beside
 * the downloads. `totals` are recomputed from the lines at both ends, so they
 * cannot differ without the lines differing first, and comparing them would
 * only ever repeat what `items` already said. `sourceThread` is the email the
 * quotation came out of rather than anything printed on it, and a thread that
 * has moved on is already said, in its own words, at the top of this screen.
 *
 * `customerId` records WHICH ledger was billed and never appears on the
 * letterhead, so it cannot make the file disagree with the screen — which is
 * the only thing this comparison is for. It also cannot drift on its own:
 * choosing a different ledger rewrites the address, GSTIN and ship-to state
 * with it, and `customer` is compared.
 *
 * Listed rather than assumed, because the type below is the complement of it:
 * a field that is not named here is a field the desk is answerable for.
 */
export const NOT_COMPARED = [
  'id',
  'ref',
  'revision',
  'totals',
  'sourceThread',
  'status',
  'createdAt',
  'customerId',
] as const

/**
 * Everything else — the fields that reach the letterhead — named by the type of
 * the record rather than by a list kept here.
 *
 * Add a field to QuoteSchema and this widens on its own, and the table below
 * stops compiling until the new field is either compared or declared above to
 * be none of this screen's business. That is the only reason it is a type and
 * not eight strings: a field nobody remembered to compare is a field that
 * changes on screen and never reaches the file.
 */
export type DocumentField = Exclude<keyof Quote, (typeof NOT_COMPARED)[number]>

/**
 * A blank box and a column that was never filled in are the same absent value.
 * The draft holds '' where the record holds undefined, and reading that as a
 * change would put the warning up on a quotation nobody has touched.
 */
const sameText = (a: string | undefined, b: string | undefined) => (a ?? '') === (b ?? '')

/**
 * How each field is compared, and what the callout calls it when it differs.
 *
 * Together in one entry so the two cannot drift apart, the way chooseRef keeps
 * the reference shown and the number claimed in one answer.
 */
const COMPARED: {
  [F in DocumentField]: { label: string; unchanged: (draft: QuoteDraft, saved: Quote) => boolean }
} = {
  date: { label: 'the date', unchanged: (d, s) => d.date === s.date },
  customer: {
    label: 'the customer',
    unchanged: (d, s) =>
      sameText(d.customer.name, s.customer.name) &&
      sameText(d.customer.address, s.customer.address) &&
      sameText(d.customer.attention, s.customer.attention) &&
      sameText(d.customer.gstin, s.customer.gstin) &&
      // Never printed, and it no longer decides the tax split either — but it
      // is what the customer master learns from a write, so a record still
      // holding the old state is a record this screen has quietly parted
      // company with.
      sameText(d.customer.state, s.customer.state),
  },
  contact: { label: 'the contact number', unchanged: (d, s) => d.contact === s.contact },
  email: { label: 'the email address', unchanged: (d, s) => d.email === s.email },
  queriesNumbers: {
    label: 'the numbers in the closing',
    // Compared, because it PRINTS: it is the "call us at" line above the
    // signature. Switching who a quotation is from changes it along with the
    // contact number and the signature, and all three have to reach the file.
    unchanged: (d, s) => d.queriesNumbers === s.queriesNumbers,
  },
  items: {
    label: 'the lines',
    unchanged: (d, s) =>
      // Position by position: the desk reorders rows, and a quotation whose
      // lines are in a different order is a different document.
      d.items.length === s.items.length &&
      d.items.every((item, i) => {
        const stored = s.items[i]!
        return (
          sameText(item.desc, stored.desc) &&
          sameText(item.make, stored.make) &&
          sameText(item.partCode, stored.partCode) &&
          sameText(item.hsn, stored.hsn) &&
          item.qty === stored.qty &&
          // Paise both sides, compared as the integers they are.
          item.rate === stored.rate
        )
      }),
  },
  tax: {
    label: 'the tax',
    unchanged: (d, s) => d.tax.mode === s.tax.mode && d.tax.rate === s.tax.rate,
  },
  terms: {
    label: 'the terms',
    unchanged: (d, s) =>
      sameText(d.terms.payment, s.terms.payment) &&
      sameText(d.terms.delivery, s.terms.delivery) &&
      sameText(d.terms.prices, s.terms.prices) &&
      sameText(d.terms.validity, s.terms.validity) &&
      sameText(d.terms.warranty, s.terms.warranty),
  },
  signatory: { label: 'the signatory', unchanged: (d, s) => d.signatory === s.signatory },
}

export const DOCUMENT_FIELDS = Object.keys(COMPARED) as DocumentField[]

/**
 * Which fields the screen and the saved record disagree about.
 *
 * By value and never by identity. The draft is a fresh object on every
 * keystroke, so anything shaped like `draft !== saved` is true from the first
 * character typed and would leave the warning up permanently — a warning that is
 * always on is a warning nobody reads, and this one has to still be legible on
 * the day it matters.
 *
 * Nothing saved is nothing to disagree with: an unsaved quotation has no record
 * behind it, and the Save button already says so.
 */
export function documentChanges(draft: QuoteDraft, saved: Quote | null): DocumentField[] {
  if (!saved) return []
  return DOCUMENT_FIELDS.filter((field) => !COMPARED[field].unchanged(draft, saved))
}

/** The changed fields as the desk reads them, in the order they print. */
export const changeLabels = (fields: DocumentField[]) => fields.map((f) => COMPARED[f].label)

/**
 * The two halves of a download, in the only order they work in.
 *
 * Handed its work rather than reaching for it, so the order can be PROVED
 * without a browser instead of read and hoped for. /api/render loads the stored
 * row, so a screen that has moved on since the save has to put the row right
 * before anything is rendered off it — that is the whole of this fix.
 *
 * `render` runs only if `persist` resolved. A write that failed followed by a
 * download that went ahead anyway is the original bug with an error message
 * over it: the desk still gets the older document, and now believes it is
 * current because they watched it save.
 */
export async function downloadCurrent(step: {
  changed: boolean
  persist: () => Promise<unknown>
  render: () => Promise<void>
}): Promise<void> {
  if (step.changed) await step.persist()
  await step.render()
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
