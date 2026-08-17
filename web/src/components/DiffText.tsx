import { useMemo } from 'react'
import { wordDiff } from '../lib/diff'

interface Props {
  /** The text to render. */
  text: string
  /** The other side, to compare against. */
  against: string
  /**
   * Only true on rows that already carry a flag. On a clean row the two sides
   * may legitimately be worded differently, and highlighting that would cost
   * amber its meaning (§9) — so a clean row renders as plain text.
   */
  highlight: boolean
}

/**
 * Renders a product description with the parts that differ from the other side
 * marked in place.
 *
 * The flag underneath already says a line drifted. This says *where*, so nobody
 * has to compare two long descriptions word by word to find the "1" that should
 * have been "1.5".
 */
export default function DiffText({ text, against, highlight }: Props) {
  const parts = useMemo(
    () => (highlight ? wordDiff(text, against).left : null),
    [text, against, highlight],
  )

  if (!parts) return <>{text}</>

  return (
    <>
      {parts.map((part, i) =>
        part.changed ? (
          <mark key={i} className="diff-changed">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  )
}
