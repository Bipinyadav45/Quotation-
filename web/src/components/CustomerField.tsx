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
 * The Customer name field, with a typeahead over customers already quoted.
 *
 * The master fills itself from saved quotations, so the second quotation to a
 * customer offers back everything the first one typed. That matters most for
 * the GSTIN: it is long, it is unforgiving, and it goes on a tax document.
 *
 * Picking a row fills the other fields but never locks them — a customer who
 * has moved office is edited here and the new address is remembered on save.
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
        placeholder="Start typing — customers you have quoted before will appear"
      />

      {visible && (
        <ul className="absolute left-0 right-0 top-full z-20 max-h-64 overflow-y-auto border border-rule-strong bg-paper-raised">
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
                className={`block w-full px-2 py-1.5 text-left text-[13px] ${
                  i === highlight ? 'bg-accent-faint' : 'hover:bg-paper-sunk'
                }`}
              >
                <span className="font-medium">{customer.name}</span>
                <span className="ml-2 text-[11px] text-ink-faint">
                  {customer.quoteCount} quotation{customer.quoteCount === 1 ? '' : 's'}
                  {customer.state && ` · ${customer.state}`}
                  {customer.gstin && ' · GSTIN on file'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
