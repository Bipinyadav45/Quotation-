import express from 'express'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiReadResponseSchema, type ParseResponse } from '@shared/schema.js'
import type { AiResult } from '../lib/ai.js'
import type { ThreadRead } from '../lib/readThread.js'
import { parseRoutes } from './parse.js'

/**
 * POST /parse/ai reads the lines and the customer in ONE call, and what is
 * tested here is every way that call can land: it works; it fails; it throws
 * on the database it touches; it succeeds but finds no products. In all four
 * the answer is 200 and the desk keeps whatever worked — an AI feature failing
 * is not an error page in a tool people quote from.
 *
 * It used to be two calls, and this file used to prove they failed
 * independently. They no longer can, and that is the point: two calls cost two
 * to eight requests per press against a twenty-a-day allowance. What survives
 * is the guarantee that mattered — lines on the screen whatever went wrong.
 *
 * The model is never called: readThreadWithAi is stubbed at the module
 * boundary. resolveCustomer is left real, because merging the read against the
 * customer master is the part worth exercising through the route.
 */
const stub = vi.hoisted(() => ({ readThreadWithAi: vi.fn() }))

vi.mock('../lib/readThread.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/readThread.js')>()),
  readThreadWithAi: stub.readThreadWithAi,
}))

const THREAD = 'Please quote 10 x Logitech MK540 keyboard mouse combo.'

/** The sentence both halves come back with when there is no key. */
const NO_KEY = 'The AI features are not configured — no API key is set on the server.'

const LLM_LINES: ParseResponse = {
  lines: [
    {
      id: 'llm-1',
      raw: '10 x Logitech MK540',
      desc: 'Logitech MK540 keyboard mouse combo',
      make: 'Logitech',
      partCode: 'MK540',
      qty: 10,
      rate: 0,
      role: 'request',
      source: 'llm',
    },
  ],
  source: 'llm',
  skipped: [],
  warnings: [],
}

const PATTERN_FALLBACK: ParseResponse = {
  lines: [],
  source: 'pattern',
  skipped: [],
  warnings: [],
  note: NO_KEY + ' The pattern parser was used instead.',
}

const EXTRACTED = {
  name: 'Zensar Technologies',
  address: 'Kharadi, Pune 411014',
  attention: 'Ms. Priya Nair',
  gstin: '27AABCU9603R1ZM',
  state: 'Maharashtra',
  confidence: 'high',
} as const

/** The whole read, as one call now answers it. */
const GOOD_READ: AiResult<ThreadRead> = {
  ok: true,
  data: { lines: LLM_LINES.lines, rejected: [], extracted: { ...EXTRACTED }, candidates: [] },
}

/** The same read, but the thread named products nowhere. */
const NO_LINES: AiResult<ThreadRead> = {
  ok: true,
  data: { lines: [], rejected: [], extracted: { ...EXTRACTED }, candidates: [] },
}

/** One row of the customer master, as the route hands it back. */
const ledger = (name: string, gstin: string, state: string) => ({
  id: name,
  name,
  address: name.replace(/^.*\(|\)$/g, ''),
  attention: '',
  gstin,
  state,
  contact: '',
  email: '',
  country: 'India',
  regType: 'Regular',
  source: 'tally' as const,
  quoteCount: 0,
  lastUsedAt: '2026-01-01T00:00:00.000Z',
})

let server: Server
let origin: string

beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api', parseRoutes)
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
})

afterAll(() => {
  server.close()
})

beforeEach(() => {
  stub.readThreadWithAi.mockReset()
})

function post(thread: string) {
  return fetch(origin + '/api/parse/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ thread }),
  })
}

async function readWithAi() {
  const response = await post(THREAD)
  // Always the shape the client is typed against, whichever half fell over.
  return { status: response.status, body: AiReadResponseSchema.parse(await response.json()) }
}

describe('POST /parse/ai', () => {
  it('returns the lines and the customer when the read works', async () => {
    stub.readThreadWithAi.mockResolvedValue(GOOD_READ)

    const { status, body } = await readWithAi()

    expect(status).toBe(200)
    expect(body.source).toBe('llm')
    expect(body.lines).toHaveLength(1)
    expect(body.note).toBeUndefined()
    expect(body.customer).toEqual({
      name: 'Zensar Technologies',
      address: 'Kharadi, Pune 411014',
      attention: 'Ms. Priya Nair',
      gstin: '27AABCU9603R1ZM',
      state: 'Maharashtra',
    })
    expect(body.customerFrom).toBe('thread')
    expect(body.customerMissing).toEqual([])
    expect(body.customerNote).toBeUndefined()
  })

  it('fills nothing in and offers the ledgers when several could be the customer', async () => {
    /**
     * The route's half of the rule. Two ledgers with different GSTINs and
     * different states matched, so the four deciding fields come back blank and
     * the shortlist comes back instead — see AiReadResponseSchema. The lines are
     * unaffected: the customer being unresolved is not a failure of the read.
     */
    stub.readThreadWithAi.mockResolvedValue({
      ok: true,
      data: {
        lines: LLM_LINES.lines,
        rejected: [],
        extracted: { ...EXTRACTED, name: 'Azentio Software Pvt Ltd' },
        candidates: [
          {
            record: ledger('AZENTIO SOFTWARE PVT LTD (MALAD)', '27AAUCA4876F1Z4', 'Maharashtra'),
            score: 1,
            gstinMatch: false,
          },
          {
            record: ledger('AZENTIO SOFTWARE PVT LTD (HYD)', '36AAUCA4876F1Z5', 'Telangana'),
            score: 1,
            gstinMatch: false,
          },
        ],
      },
    } as AiResult<ThreadRead>)

    const { status, body } = await readWithAi()

    expect(status).toBe(200)
    expect(body.lines).toHaveLength(1)
    expect(body.customerCandidates).toHaveLength(2)
    expect(body.customer?.address).toBe('')
    expect(body.customer?.gstin).toBe('')
    expect(body.customer?.state).toBe('')
    // The name survives, because the chooser has to ask its question with it.
    expect(body.customer?.name).toBe('Azentio Software Pvt Ltd')
    // Each candidate carries what it would fill in, so choosing costs no round trip.
    expect(body.customerCandidates[0]?.customer.gstin).toBe('27AAUCA4876F1Z4')
    expect(body.customerCandidates[1]?.customer.state).toBe('Telangana')
  })

  it('costs exactly one request, however many halves the answer has', async () => {
    // The whole reason this route stopped making two calls. A press that costs
    // two is a press the free tier allows ten of a day, and the desk ran out
    // twice believing the key was at fault.
    stub.readThreadWithAi.mockResolvedValue(GOOD_READ)

    await readWithAi()

    expect(stub.readThreadWithAi).toHaveBeenCalledTimes(1)
    expect(stub.readThreadWithAi).toHaveBeenCalledWith(THREAD)
  })

  it('still gives the desk lines when the read fails', async () => {
    stub.readThreadWithAi.mockResolvedValue({
      ok: false,
      reason: 'The AI quota for this key is used up for now.',
    })

    const { status, body } = await readWithAi()

    expect(status).toBe(200)
    expect(body.source).toBe('pattern')
    expect(body.note).toContain('The AI quota for this key is used up for now.')
    expect(body.note).toContain('pattern parser')
    // null, not an all-blank record: the read FAILED, which is a different
    // situation from a thread that named nobody, and nothing is known to be
    // missing because nothing was read.
    expect(body.customer).toBeNull()
    expect(body.customerMissing).toEqual([])
  })

  it('still gives the desk lines when the read throws', async () => {
    // The read touches the database to shortlist ledgers. A locked database
    // must not cost the desk its line items.
    stub.readThreadWithAi.mockRejectedValue(new Error('database is locked'))

    const { status, body } = await readWithAi()

    expect(status).toBe(200)
    expect(body.source).toBe('pattern')
    expect(body.note).toContain('database is locked')
    expect(body.customer).toBeNull()
  })

  it('keeps the customer when the thread named no products', async () => {
    // Half an answer is still worth having: the address block fills itself even
    // though the lines have to be typed.
    stub.readThreadWithAi.mockResolvedValue(NO_LINES)

    const { status, body } = await readWithAi()

    expect(status).toBe(200)
    expect(body.source).toBe('pattern')
    expect(body.note).toContain('found no line items')
    expect(body.customer?.name).toBe('Zensar Technologies')
    expect(body.customerNote).toBeUndefined()
  })

  it('states a shared failure once rather than once per half', async () => {
    stub.readThreadWithAi.mockResolvedValue({ ok: false, reason: NO_KEY })

    const { status, body } = await readWithAi()

    expect(status).toBe(200)
    expect(body.source).toBe('pattern')
    expect(body.customer).toBeNull()

    // Said once across the whole reply, not once per half: one missing key is
    // one fault, however many things it broke.
    const said = (body.note ?? '') + '\n' + (body.customerNote ?? '')
    expect(said.split(NO_KEY)).toHaveLength(2)
    // ...and the customer still gets a sentence of its own.
    expect(body.customerNote).toBeTruthy()
  })

  it('rejects an empty thread before the model is asked anything', async () => {
    const response = await post('')

    expect(response.status).toBe(400)
    expect(stub.readThreadWithAi).not.toHaveBeenCalled()
  })
})

describe('GET /capabilities', () => {
  it('advertises the one merged button and nothing that no longer exists', async () => {
    const body = (await (await fetch(origin + '/api/capabilities')).json()) as Record<
      string,
      boolean
    >

    expect(body).toHaveProperty('readWithAi')
    expect(body).toHaveProperty('llm')
    expect(body.readWithAi).toBe(body.llm)

    // `parseWithAi` and `extractCustomer` stood for the two buttons the merged
    // one replaced, and they went with their routes. Asserted absent rather
    // than simply unmentioned: a flag the server still advertises for a route
    // it no longer serves is how a dead button gets drawn.
    expect(body).not.toHaveProperty('parseWithAi')
    expect(body).not.toHaveProperty('extractCustomer')
  })
})
