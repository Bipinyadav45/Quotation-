import { useEffect, useState } from 'react'

/**
 * What the screen shows while a thread is being read.
 *
 * The only feedback used to be the button's own label changing to "Reading with
 * AI…". For the plain parser that is fine — it answers in milliseconds. For the
 * AI it is not: the read takes six to thirty seconds, nothing on the screen
 * moves, and the desk concludes it has hung and presses again. That is how a
 * twenty-a-day allowance gets spent twice as fast as it needs to be.
 *
 * So: something that moves, a plain account of what is happening, and the
 * seconds counted honestly. No percentage — the server cannot know how far
 * through a model is, and a bar that stalls at 90% teaches people to distrust
 * every bar you ever show them.
 */

interface Props {
  mode: 'pattern' | 'ai'
}

/**
 * Said in the order they happen, so the wait has a shape.
 *
 * These are descriptions, not measurements — the AI read is ONE call and the
 * server cannot report its progress. They are timed from what the step
 * ordinarily takes, and the last one has no successor, so a slow read rests
 * there rather than claiming to have finished something it has not.
 */
const AI_STEPS: Array<{ after: number; says: string }> = [
  { after: 0, says: 'Sending the thread to be read…' },
  { after: 4, says: 'Picking out the products, the quantities and the prices…' },
  { after: 9, says: 'Reading the customer from the signature…' },
  { after: 16, says: 'Still going. A long thread takes longer — nothing has gone wrong.' },
]

export default function ReadingProgress({ mode }: Props) {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const started = Date.now()
    const tick = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(tick)
  }, [])

  const says =
    mode === 'pattern'
      ? 'Reading the thread…'
      : [...AI_STEPS].reverse().find((s) => seconds >= s.after)!.says

  return (
    <div className="panel mt-3 p-3 no-print" role="status" aria-live="polite">
      <div className="reading-track mb-2" />
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[13px]">{says}</p>
        {/* Only once it has been long enough to wonder. A counter that starts at
            zero the instant you click makes a fast answer feel slow. */}
        {seconds >= 3 && (
          <span className="label shrink-0 tabular-nums text-ink-faint">{seconds}s</span>
        )}
      </div>
      {mode === 'ai' && (
        <p className="mt-1 text-[11px] text-ink-faint">
          The lines and the customer come back together, in one request.
        </p>
      )}
    </div>
  )
}
