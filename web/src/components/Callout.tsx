import type { ReactNode } from 'react'

type Tone = 'help' | 'drift' | 'problem'

const TONE: Record<Tone, { box: string; label: string }> = {
  /** Explains the screen or the next action. Quiet by design. */
  help: { box: 'border-rule bg-paper-sunk/60 text-ink-muted', label: 'text-ink-faint' },
  /** §9 — amber, and only ever for drift. */
  drift: { box: 'border-drift-rule bg-drift-bg text-drift', label: 'text-drift' },
  /**
   * A system failure, which is a different thing from drift. Kept visually
   * distinct so it cannot be mistaken for a flag — if it were amber, amber
   * would stop meaning "the customer asked for something else".
   */
  problem: { box: 'border-alert-rule bg-alert-bg text-alert', label: 'text-alert' },
}

interface Props {
  tone?: Tone
  label?: string
  children: ReactNode
  className?: string
}

export default function Callout({ tone = 'help', label, children, className = '' }: Props) {
  const style = TONE[tone]
  return (
    <div className={`border px-3 py-2 text-[12.5px] leading-snug ${style.box} ${className}`}>
      {label && <span className={`label mr-2 ${style.label}`}>{label}</span>}
      {children}
    </div>
  )
}
