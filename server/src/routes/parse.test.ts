import express from 'express'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiReadResponseSchema, type ParseResponse } from '@shared/schema.js'
import type { AiResult } from '../lib/ai.js'
import type { ExtractionResult } from '../lib/extractCustomer.js'
import { parseRoutes } from './parse.js'

/**
 * POST /parse/ai reads the lines and the customer in one pass, from two calls
 * that fail independently. What is tested here is the four ways that can land:
 * both halves working, either one working alone, and neither. In all four the
 * answer is 200 and the desk keeps whatever worked — an AI feature failing is
 * not an error page in a tool people quote from.
 *
 * The model is never called. Both halves are stubbed at the module boundary,
 * but resolveCustomer is left real: the merging is the part worth exercising
 * through the route.
 */
const stub = vi.hoisted(() => ({
  parseThreadWithClaude: vi.fn(),
  extractCustomerFromThread: vi.fn(),
}))

vi.mock('../lib/llmParser.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/llmParser.js')>()),
  parseThreadWithClaude: stub.parseThreadWithClaude,
}))

vi.mock('../lib/extractCustomer.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/extractCustomer.js')>()),
  extractCustomerFromThread: stub.extractCustomerFromThread,
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

const CUSTOMER_READ: AiResult<ExtractionResult> = {
  ok: true,
  data: {
    extracted: {
      name: 'Zensar Technologies',
      address: 'Kharadi, Pune 411014',
      attention: 'Ms. Priya Nair',
      gstin: '27AABCU9603R1ZM',
      state: 'Maharashtra',
      confidence: 'high',
    },
    onFile: null,
  },
}

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
  stub.parseThreadWithClaude.mockReset()
  stub.extractCustomerFromThread.mockReset()
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
  it('returns both halves when both succeed', async () => {
    stub.parseThreadWithClaude.mockResolvedValue(LLM_LINES)
    stub.extractCustomerFromThread.mockResolvedValue(CUSTOMER_READ)

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

  it('keeps the lines when the customer read fails', async () => {
    stub.parseThreadWithClaude.mockResolvedValue(LLM_LINES)
    stub.extractCustomerFromThread.mockResolvedValue({
      ok: false,
      reason: 'The AI quota for this key is used up for now.',
    })

    const { status, body } = await readWithAi()

    expect(status).toBe(200)
    expect(body.source).toBe('llm')
    expect(body.lines).toHaveLength(1)
    // null, not an all-blank record: the read FAILED, which is a different
    // situation from a thread that named nobody, and nothing is known to be
    // missing because nothing was read.
    expect(body.customer).toBeNull()
    expect(body.customerNote).toBe('The AI quota for this key is used up for now.')
    expect(body.customerMissing).toEqual([])
  })

  it('keeps the lines when the customer read throws', async () => {
    // The customer half touches the database. Promise.all would let a locked
    // database take the line items down with it; allSettled does not.
    stub.parseThreadWithClaude.mockResolvedValue(LLM_LINES)
    stub.extractCustomerFromThread.mockRejectedValue(new Error('database is locked'))

    const { status, body } = await readWithAi()

    expect(status).toBe(200)
    expect(body.lines).toHaveLength(1)
    expect(body.customer).toBeNull()
    expect(body.customerNote).toContain('database is locked')
  })

  it('keeps the customer when the lines fall back to the pattern parser', async () => {
    stub.parseThreadWithClaude.mockResolvedValue(PATTERN_FALLBACK)
    stub.extractCustomerFromThread.mockResolvedValue(CUSTOMER_READ)

    const { status, body } = await readWithAi()

    expect(status).toBe(200)
    expect(body.source).toBe('pattern')
    expect(body.note).toBe(PATTERN_FALLBACK.note)
    expect(body.customer?.name).toBe('Zensar Technologies')
    expect(body.customerNote).toBeUndefined()
  })

  it('states a shared failure once when both halves fail for the same reason', async () => {
    stub.parseThreadWithClaude.mockResolvedValue(PATTERN_FALLBACK)
    stub.extractCustomerFromThread.mockResolvedValue({ ok: false, reason: NO_KEY })

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

  it('rejects an empty thread before either half is called', async () => {
    const response = await post('')

    expect(response.status).toBe(400)
    expect(stub.parseThreadWithClaude).not.toHaveBeenCalled()
    expect(stub.extractCustomerFromThread).not.toHaveBeenCalled()
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
