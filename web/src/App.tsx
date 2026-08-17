import { useApi } from './lib/api'

type Health = {
  status: 'ok' | 'degraded' | 'error'
  checks: Record<string, { ok: boolean; detail: string }>
}

const STEPS = [
  { n: 1, label: 'Email thread' },
  { n: 2, label: 'Ask vs quote' },
  { n: 3, label: 'Quotation' },
  { n: 4, label: 'Document' },
  { n: 5, label: 'History' },
] as const

export default function App() {
  const health = useApi<Health>('/api/health')

  return (
    <div className="min-h-screen">
      <header className="border-b border-rule-strong bg-paper-raised">
        <div className="flex items-baseline gap-6 px-6 py-3">
          <h1 className="text-[15px] font-semibold tracking-tight">
            Quotation Desk
            <span className="ml-2 font-normal text-ink-faint">Newtech Computer Services</span>
          </h1>
          <nav className="flex gap-1 text-[13px]">
            {STEPS.map((s) => (
              <span
                key={s.n}
                className="border border-transparent px-2 py-1 text-ink-muted"
                aria-disabled="true"
              >
                <span className="label mr-1.5">{String(s.n).padStart(2, '0')}</span>
                {s.label}
              </span>
            ))}
          </nav>
        </div>
      </header>

      <main className="px-6 py-6">
        <section className="panel max-w-3xl p-4">
          <h2 className="label mb-3">System</h2>

          {health.loading && <p className="text-ink-muted">Checking…</p>}

          {health.error && (
            <p className="text-drift">Cannot reach the server — {health.error.message}</p>
          )}

          {health.data && (
            <table className="w-full text-[13px]">
              <tbody>
                {Object.entries(health.data.checks).map(([name, check]) => (
                  <tr key={name} className="border-t border-rule first:border-t-0">
                    <td className="label w-28 py-2 align-top">{name}</td>
                    <td className="w-20 py-2 align-top">
                      {check.ok ? (
                        <span className="text-accent">ready</span>
                      ) : (
                        <span className="text-drift">unavailable</span>
                      )}
                    </td>
                    <td className="py-2 align-top text-ink-muted">{check.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <p className="mt-6 max-w-3xl text-[13px] text-ink-muted">
          Milestone 1 · scaffold. The reconciliation core lands next, before any further UI.
        </p>
      </main>
    </div>
  )
}
