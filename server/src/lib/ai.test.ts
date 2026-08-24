import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT } from '../config.js'
import { DEFAULT_MODEL } from './ai.js'

/**
 * Why a source-level test rather than a behavioural one.
 *
 * What broke here cannot be reproduced against the real endpoint on demand: a
 * model stopped answering — not a refusal, not an error, just silence for over
 * three minutes — and `fetch` has no timeout of its own, so the request sat
 * open with the desk watching a button do nothing. Stubbing a hang would test
 * the stub. What is worth pinning is the two decisions that make a hang
 * survivable, and both are visible in the source.
 */

const SOURCE = readFileSync(path.join(ROOT, 'server', 'src', 'lib', 'ai.ts'), 'utf8')

describe('a model that stops answering', () => {
  it('is cut off rather than waited on for ever', () => {
    // fetch() without a signal waits indefinitely. This is the line that turns
    // silence into something the fallback chain can act on.
    expect(SOURCE, 'the request has no abort signal').toMatch(/signal:\s*\w+/)
    expect(SOURCE).toMatch(/AbortSignal\.timeout\(/)
  })

  it('reads as busy, so the next model is actually tried', () => {
    // askAi advances only on the word "busy". A timeout classified as a hard
    // failure would stop the chain — the cut-off would just fail faster than
    // waiting did, which is not the point of having four models.
    const handler = /TimeoutError[\s\S]{0,400}/.exec(SOURCE)?.[0] ?? ''
    expect(handler, 'nothing handles a timeout').not.toBe('')
    expect(handler, 'a timeout does not report as busy').toContain('busy')
  })

  it('gives a model long enough to answer properly before giving up', () => {
    // The models that work answer in about a second and a half. Generous by ten
    // times is deliberate: cutting off a slow but healthy answer costs a real
    // read, and the whole chain is bounded anyway.
    const ms = Number(/REQUEST_TIMEOUT_MS\s*=\s*([\d_]+)/.exec(SOURCE)?.[1]?.replace(/_/g, ''))
    expect(ms).toBeGreaterThanOrEqual(10_000)
    expect(ms, 'a desk waiting on this has a customer on the phone').toBeLessThanOrEqual(30_000)
  })
})

describe('the model the desk gets first', () => {
  it('is one that answers, not merely the newest', () => {
    // gemini-3.7-flash was the default on version number alone. It returned 503,
    // then stopped answering at all, and it was tried first on every single
    // call. The order here is by what was measured to reply.
    expect(DEFAULT_MODEL).not.toBe('gemini-3.7-flash')
  })

  it('still keeps every model reachable, so a recovery is not locked out', () => {
    // Demoted, not deleted: if it comes back, it is one measurement away from
    // being promoted again, and until then the timeout bounds what it costs.
    const fallbacks = /MODEL_FALLBACKS\s*=\s*\[([^\]]*)\]/.exec(SOURCE)?.[1] ?? ''
    expect([DEFAULT_MODEL, fallbacks].join(' ')).toContain('gemini-3.7-flash')
    expect(fallbacks.indexOf('gemini-3.7-flash'), 'the model that hangs is tried early').toBe(
      Math.max(...['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.7-flash'].map((m) => fallbacks.indexOf(m))),
    )
  })
})
