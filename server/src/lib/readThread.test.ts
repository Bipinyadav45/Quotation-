import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What a press of "Read it with AI" COSTS.
 *
 * The free tier allows twenty requests a day. The old shape — two calls fired
 * together, each walking a fallback chain of up to four models — spent between
 * two and eight of them on a single press, so three presses could exhaust a
 * key. It did, twice, and a healthy key was replaced both times.
 *
 * These are the two rules that keep it to one, and neither is visible from
 * reading the reply: the same answer comes back whether it cost a request or
 * not, which is exactly why it needs a test.
 */
const { askAi, findCustomerByName, searchCustomers } = vi.hoisted(() => ({
  askAi: vi.fn(),
  findCustomerByName: vi.fn(),
  searchCustomers: vi.fn(),
}))

vi.mock('./ai.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ai.js')>()),
  askAi,
}))

vi.mock('./customers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./customers.js')>()),
  findCustomerByName,
  searchCustomers,
}))

const { clearReadCache, cachedReads, readThreadWithAi } = await import('./readThread.js')

const CUSTOMER = {
  name: 'Zensar Technologies',
  address: 'Kharadi, Pune 411014',
  attention: 'Ms. Priya Nair',
  gstin: '27AABCU9603R1ZM',
  state: 'Maharashtra',
  confidence: 'high' as const,
}

const LINE = {
  raw: '10 x Logitech MK540 - Rs. 3,450 each',
  desc: 'Logitech MK540',
  make: 'Logitech',
  partCode: 'MK540',
  qty: 10,
  rateText: '3,450',
  role: 'offer' as const,
}

beforeEach(() => {
  askAi.mockReset().mockResolvedValue({ ok: true, data: { lines: [LINE], customer: CUSTOMER } })
  findCustomerByName.mockReset().mockReturnValue(null)
  searchCustomers.mockReset().mockReturnValue([])
  clearReadCache()
})

describe('what one press costs', () => {
  it('asks once for the lines and the customer together', async () => {
    // Two calls is what made a twenty-a-day allowance last three presses.
    const result = await readThreadWithAi('Please quote 10 x MK540.')

    expect(askAi).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.lines).toHaveLength(1)
    expect(result.data.extracted.name).toBe('Zensar Technologies')
  })

  it('answers the same thread again without paying for it', async () => {
    const first = await readThreadWithAi('Please quote 10 x MK540.')
    const second = await readThreadWithAi('Please quote 10 x MK540.')

    expect(askAi).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })

  it('asks again once the thread has actually changed', async () => {
    // The cache is keyed on the text, so an edited thread is a different
    // question. Answering the old one from memory would be worse than the cost.
    await readThreadWithAi('Please quote 10 x MK540.')
    await readThreadWithAi('Please quote 12 x MK540.')

    expect(askAi).toHaveBeenCalledTimes(2)
  })

  it('remembers nothing it did not manage to read', async () => {
    // Caching a failure would turn one spent quota into a permanently dead
    // button until the process restarted.
    askAi.mockResolvedValue({ ok: false, reason: 'The AI quota for this key is used up for now.' })

    const first = await readThreadWithAi('Please quote 10 x MK540.')
    expect(first.ok).toBe(false)
    expect(cachedReads()).toBe(0)

    askAi.mockResolvedValue({ ok: true, data: { lines: [LINE], customer: CUSTOMER } })
    const second = await readThreadWithAi('Please quote 10 x MK540.')

    expect(second.ok).toBe(true)
    expect(askAi).toHaveBeenCalledTimes(2)
  })

  it('does not grow without limit', async () => {
    // A day at the desk is a few dozen threads; this is a backstop against a
    // long-running process, not a policy.
    for (let i = 0; i < 40; i++) await readThreadWithAi(`Quote ${i} x MK540.`)

    expect(cachedReads()).toBeLessThanOrEqual(32)
    expect(cachedReads()).toBeGreaterThan(0)
  })
})

describe('what the one answer is turned into', () => {
  it('parses the rate into integer paise, never a float', async () => {
    const result = await readThreadWithAi('Please quote 10 x MK540.')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.lines[0]!.rate).toBe(345_000)
    expect(Number.isInteger(result.data.lines[0]!.rate)).toBe(true)
  })

  it('surfaces a line whose rate could not be read rather than quoting zero', async () => {
    askAi.mockResolvedValue({
      ok: true,
      data: { lines: [{ ...LINE, rateText: 'on request' }], customer: CUSTOMER },
    })

    const result = await readThreadWithAi('Please quote 10 x MK540.')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.lines).toHaveLength(0)
    expect(result.data.rejected.join(' ')).toContain('on request')
  })
})
