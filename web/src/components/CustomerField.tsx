import { useEffect, useRef, useState } from 'react'
import type { CustomerRecord } from '@shared/schema'
import { apiGet } from '../lib/api'

interface Props {
  value: string
  onChange: (name: string) => void
  /** Fired when a stored customer is picked — fills every field at once. */
  onPick: (customer: CustomerRecord) => void
  className: string
}

/**
 * The Customer name field, with a typeahead over the customer master.
 *
 * The master is the desk's Tally sundry debtors list, plus whatever quoting off
 * it has added. Picking a row fills the other fields but never locks them — a
 * customer who has moved office is edited here and the new address is
 * remembered on save.
 *
 * EVERY ROW SHOWS ITS ADDRESS, and that is not decoration. Three ledgers on the
 * real list — Azentio Ghansoli, Malad and Vashi — share a name and a GSTIN and
 * differ only in where they are. This list used to show the name, the state and
 * the words "GSTIN on file", which is identical for all three: it offered the
 * desk three rows that looked the same and no way to tell which was which.
 *
 * The search reaches the address and the GSTIN too, so "powai" and a pasted
 * registration number both find a customer whose Tally spelling nobody
 * remembers.
 */
export default function CustomerField({ value, onChange, onPick, className }: Props) {
  const [matches, setMatches] = useState<CustomerRecord[]>([])
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  /** Set while a pick is being applied, so it does not immediately re-search. */
  const justPicked = useRef(false)

  // Debounced, so a name typed at speed is one request rather than fifteen.
  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false
      return
    }
    const handle = setTimeout(() => {
      apiGet<{ customers: CustomerRecord[] }>(
        `/api/customers?q=${encodeURIComponent(value.trim())}`,
      )
        .then((r) => {
          setMatches(r.customers)
          setHighlight(0)
        })
        .catch(() => setMatches([]))
    }, 180)
    return () => clearTimeout(handle)
  }, [value])

  // Clicking anywhere else closes it.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const visible = open && matches.length > 0

  function pick(customer: CustomerRecord) {
    justPicked.current = true
    onPick(customer)
    setOpen(false)
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!visible) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlight((h) => Math.min(h + 1, matches.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            const chosen = matches[highlight]
            if (chosen) pick(chosen)
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
        className={className}
        autoComplete="off"
        placeholder="Start typing a name, a place, or a GSTIN"
      />

      {visible && (
        <ul className="absolute left-0 right-0 top-full z-20 max-h-80 overflow-y-auto border border-rule-strong bg-paper-raised">
          {matches.map((customer, i) => (
            <li key={customer.id}>
              <button
                type="button"
                // mousedown, not click: the input's blur would close the list
                // before a click ever landed.
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(customer)
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`block w-full px-2 py-1.5 text-left ${
                  i === highlight ? 'bg-accent-faint' : 'hover:bg-paper-sunk'
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-medium">{customer.name}</span>
                  <span className="shrink-0 text-[11px] text-ink-faint">
                    {customer.quoteCount > 0
                      ? `${customer.quoteCount} quotation${customer.quoteCount === 1 ? '' : 's'}`
                      : 'never quoted'}
                  </span>
                </div>
                {/* One line here, unlike the chooser's full block: this list is
                    for finding a customer you already have in mind, and the
                    first line carries the building. */}
                {customer.address !== '' && (
                  <div className="truncate text-[11px] text-ink-faint">
                    {customer.address.replace(/\s*\n\s*/g, ', ')}
                  </div>
                )}
                <div className="font-mono text-[11px] text-ink-faint">
                  {customer.gstin === '' ? (
                    <span className="italic">no GSTIN</span>
                  ) : (
                    customer.gstin
                  )}
                  {customer.state !== '' && ` · ${customer.state}`}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
