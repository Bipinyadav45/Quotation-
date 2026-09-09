import type { CustomerCandidate } from '@shared/schema'

interface Props {
  candidates: CustomerCandidate[]
  /** The name the thread gave, for the heading. May be blank. */
  readName: string
  onChoose: (candidate: CustomerCandidate) => void
  onDismiss: () => void
}

/**
 * Which of these is the customer?
 *
 * This screen exists because the answer cannot be computed. The desk's customer
 * master is their Tally sundry debtors list, where sixteen ledgers are spelled
 * some version of "Datamatics Global Services Limited", seventeen answer to
 * "Morgan Stanley", and three Azentio sites share a name AND a GSTIN. A thread
 * that names a company has narrowed the list; it has not identified anybody.
 *
 * So nothing is filled in until a row here is clicked. That is the rule, and it
 * is why the customer fields below sit empty while this is on screen rather
 * than showing a best guess that would be right most of the time — "most of the
 * time" means a different company's GSTIN and ship-to state on a tax document
 * the rest of it, and the ship-to state silently changes the tax split.
 *
 * WHAT EACH ROW SHOWS is the whole design. The name is the least useful thing
 * here — it is nearly identical down the list — so the ADDRESS is given the
 * room, because for three of these ledgers it is the only difference there is.
 * The GSTIN and state come next, since those are what a wrong pick gets wrong.
 */
export default function CustomerChooser({ candidates, readName, onChoose, onDismiss }: Props) {
  if (candidates.length === 0) return null

  const named = readName.trim() === '' ? 'this thread' : `"${readName.trim()}"`

  return (
    <div className="mb-4 border border-amber-500 bg-amber-50/60 no-print">
      <div className="border-b border-amber-500/40 px-3 py-2">
        <div className="text-[13px] font-semibold">
          {candidates.length === 1
            ? `One customer on your list looks like ${named}`
            : `${candidates.length} customers on your list could be ${named}`}
        </div>
        <div className="mt-0.5 text-[11px] text-ink-faint">
          Nothing has been filled in yet. Choose the one this quotation is for — they do not
          share a GSTIN, an address, or necessarily a ship-to state, and the state decides the
          tax split.
        </div>
      </div>

      <ul className="max-h-80 overflow-y-auto">
        {candidates.map((candidate) => (
          <li key={candidate.record.id} className="border-b border-amber-500/20 last:border-b-0">
            <button
              type="button"
              onClick={() => onChoose(candidate)}
              className="block w-full px-3 py-2 text-left hover:bg-amber-100/70"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium">{candidate.record.name}</span>
                <span className="shrink-0 text-[11px] text-ink-faint">
                  {candidate.gstinMatch && (
                    <span className="mr-2 font-medium text-accent">GSTIN matches the thread</span>
                  )}
                  {candidate.record.quoteCount > 0
                    ? `${candidate.record.quoteCount} quotation${
                        candidate.record.quoteCount === 1 ? '' : 's'
                      }`
                    : 'never quoted'}
                </span>
              </div>

              {/* The address is why this list is on screen at all, so it is not
                  truncated to one line. whitespace-pre-line keeps the shape the
                  document will print it in. */}
              {candidate.record.address !== '' && (
                <div className="mt-1 whitespace-pre-line text-[11px] leading-snug text-ink-faint">
                  {candidate.record.address}
                </div>
              )}

              <div className="mt-1 font-mono text-[11px] text-ink-faint">
                {candidate.record.gstin === '' ? (
                  <span className="italic">
                    no GSTIN on file
                    {candidate.record.regType !== '' && ` · ${candidate.record.regType}`}
                  </span>
                ) : (
                  candidate.record.gstin
                )}
                {candidate.record.state !== '' && ` · ships to ${candidate.record.state}`}
                {candidate.record.country !== 'India' && ` · ${candidate.record.country}`}
              </div>

              {/* Said per candidate, because a disagreement with THIS ledger is
                  not a disagreement with the one below it. */}
              {candidate.note !== undefined && (
                <div className="mt-1 text-[11px] italic text-ink-faint">{candidate.note}</div>
              )}
            </button>
          </li>
        ))}
      </ul>

      <div className="border-t border-amber-500/40 px-3 py-2 text-[11px]">
        <button type="button" onClick={onDismiss} className="underline hover:text-accent">
          None of these — quote a company that is not on my list
        </button>
        <span className="ml-2 text-ink-faint">
          You will need to type the address and GSTIN, and it is remembered on save.
        </span>
      </div>
    </div>
  )
}
