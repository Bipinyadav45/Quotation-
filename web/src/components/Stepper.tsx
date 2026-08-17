export interface Step {
  label: string
  /** Can the user go here right now? */
  available: boolean
  /** Why not, if not — shown on hover. */
  locked: string
}

interface Props {
  steps: Step[]
  /** The step on screen, or null when the user is off the flow (History). */
  active: number | null
  /** How many steps this quotation has completed — drives the filled track. */
  progress: number
  onSelect: (index: number) => void
}

/**
 * The progress stepper across the top of the app.
 *
 * Structure follows the reference the desk asked for: a circle per step, the
 * label beneath it, and a track between them that fills in as you go. The
 * palette does not — the reference runs a purple-to-red gradient, and §9 asks
 * for "a single deep-blue accent for navigation and primaries" and "no
 * gradients", so the track fills in the accent blue instead.
 *
 * History is deliberately not in here. It is somewhere you go, not a step you
 * pass through, and putting it in the sequence would imply a quotation is not
 * finished until you have visited it.
 */
export default function Stepper({ steps, active, progress, onSelect }: Props) {
  return (
    <ol className="flex items-start no-print">
      {steps.map((step, i) => {
        const isCurrent = i === active
        const isDone = i < progress
        const reachable = step.available

        // The track fills up to how far the quotation has got, so it still
        // reads correctly on History, where no step is the active one.
        const filledBefore = i <= progress
        const filledAfter = i < progress

        return (
          <li key={step.label} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex w-full items-center" aria-hidden="true">
              <span
                className={`h-0.5 flex-1 ${
                  i === 0 ? 'bg-transparent' : filledBefore ? 'bg-accent' : 'bg-rule'
                }`}
              />
              <span
                className={[
                  'mx-1.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 text-[10px] leading-none transition-colors',
                  isCurrent
                    ? 'border-accent bg-accent text-paper-raised ring-4 ring-accent-faint'
                    : isDone
                      ? 'border-accent bg-accent text-paper-raised'
                      : reachable
                        ? 'border-rule-strong bg-paper-raised text-ink-faint'
                        : 'border-rule bg-paper-raised text-ink-faint/60',
                ].join(' ')}
              >
                {isDone ? '✓' : ''}
              </span>
              <span
                className={`h-0.5 flex-1 ${
                  i === steps.length - 1 ? 'bg-transparent' : filledAfter ? 'bg-accent' : 'bg-rule'
                }`}
              />
            </div>

            <button
              type="button"
              disabled={!reachable}
              onClick={() => onSelect(i)}
              title={reachable ? undefined : step.locked}
              className={[
                'mt-1.5 max-w-full truncate px-1 text-[10px] uppercase tracking-wider',
                isCurrent
                  ? 'font-semibold text-accent'
                  : isDone
                    ? 'text-ink-muted hover:text-ink'
                    : reachable
                      ? 'text-ink-faint hover:text-ink'
                      : 'cursor-not-allowed text-ink-faint/60',
              ].join(' ')}
            >
              {step.label}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
