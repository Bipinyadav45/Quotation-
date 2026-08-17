import type { ReactNode } from 'react'

interface Props {
  step: number
  title: string
  /**
   * One sentence: what this screen is for, and what to do on it. Someone
   * opening the tool for the first time should not have to infer it.
   */
  purpose: string
  right?: ReactNode
}

export default function ScreenHeader({ step, title, purpose, right }: Props) {
  return (
    <div className="mb-4 border-b border-rule pb-3">
      <div className="flex items-baseline justify-between gap-6">
        <h2 className="text-[15px] font-semibold">
          <span className="label mr-2">Step {String(step).padStart(2, '0')}</span>
          {title}
        </h2>
        {right}
      </div>
      <p className="mt-1 text-[12.5px] text-ink-muted">{purpose}</p>
    </div>
  )
}
