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
 * The circle AND the label are one button, so the whole step is clickable.
 * They were separate at first, with the circle inert — which meant clicking the
 * largest and most obvious target did nothing at all.
 *
 * History is deliberately not in here. It is somewhere you go, not a step you
 * pass through, and putting it in the sequence would imply a quotation is not
 * finished until you have visited it.
 */
export default function Stepper({ steps, active, progress, onSelect }: Props) {
  return (
    <ol className="flex items-start">
      {steps.map((step, i) => {
        const isCurrent = i === active
        const isDone = i < progress
        const reachable = step.available
        const isFirst = i === 0
        const isLast = i === steps.length - 1

        // The track fills up to how far the quotation has got, so it still
        // reads correctly on History, where no step is the active one.
        const filledBefore = i <= progress
        const filledAfter = i < progress

        return (
          <li key={step.label} className="relative flex min-w-0 flex-1 flex-col items-center">
            {/* Track, behind the circles. Absolute so the button above can be a
                single uninterrupted hit target. top-[9px] centres a 2px line on
                a 20px circle. */}
            {!isFirst && (
              <span
                aria-hidden="true"
                className={`absolute left-0 top-[9px] h-0.5 w-1/2 ${
                  filledBefore ? 'bg-accent' : 'bg-rule'
                }`}
              />
            )}
            {!isLast && (
              <span
                aria-hidden="true"
                className={`absolute right-0 top-[9px] h-0.5 w-1/2 ${
                  filledAfter ? 'bg-accent' : 'bg-rule'
                }`}
              />
            )}

            <button
              type="button"
              disabled={!reachable}
              onClick={() => onSelect(i)}
              title={reachable ? `Go to ${step.label}` : step.locked}
              aria-current={isCurrent ? 'step' : undefined}
              className="group relative z-10 flex max-w-full flex-col items-center gap-1.5 px-2
                         disabled:cursor-not-allowed"
            >
              <span
                className={[
                  'grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 text-[10px] leading-none transition-colors',
                  isCurrent
                    ? 'border-accent bg-accent text-paper-raised ring-4 ring-accent-faint'
                    : isDone
                      ? 'border-accent bg-accent text-paper-raised group-hover:bg-accent-hover'
                      : reachable
                        ? 'border-rule-strong bg-paper-raised text-ink-faint group-hover:border-accent'
                        : 'border-rule bg-paper-raised text-ink-faint/60',
                ].join(' ')}
              >
                {isDone ? '✓' : ''}
              </span>

              <span
                className={[
                  'max-w-full truncate text-[10px] uppercase tracking-wider transition-colors',
                  isCurrent
                    ? 'font-semibold text-accent'
                    : isDone
                      ? 'text-ink-muted group-hover:text-accent'
                      : reachable
                        ? 'text-ink-faint group-hover:text-accent'
                        : 'text-ink-faint/60',
                ].join(' ')}
              >
                {step.label}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
