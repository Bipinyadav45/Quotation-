import type { ZodType } from 'zod'
import { config } from '../config.js'

/**
 * The one place this application talks to a model.
 *
 * Every call site needs the same six things — a key check, a block guard, a
 * content guard, a JSON parse, a Zod validation, and a promise never to throw.
 * Written once here rather than three times.
 *
 * NEVER THROWS. No key, a blocked prompt, empty content, malformed JSON, a
 * schema mismatch, a network error, a rate limit or a truncated reply all come
 * back as `{ ok: false, reason }` with a sentence a purchase-desk user can
 * read. An AI feature failing must not be an error page in a tool people quote
 * from.
 *
 * Plain fetch rather than an SDK: the wire format is three fields, Node has
 * fetch built in, and it is one fewer dependency carrying one fewer way for the
 * key to end up somewhere it should not.
 */

export type AiResult<T> = { ok: true; data: T } | { ok: false; reason: string }

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Pinned deliberately. `gemini-flash-latest` and `gemini-pro-latest` both
 * answered 503/429 on this account while the pinned flash models answered
 * instantly — an alias that moves under you is not what you want behind a
 * button someone presses while a customer waits.
 *
 * NOT the newest one. This list is ordered by what actually answers, measured
 * on this key rather than by version number: gemini-3.7-flash returned 503, and
 * then stopped answering at all — 200 seconds with no reply — while these three
 * came back in about 1.2 to 1.5 seconds each. It was the default, and it is
 * tried first on every call, so the desk pressed "Read it with AI" and watched
 * nothing happen for two minutes.
 *
 * 3.7 is still in the chain, last, so it costs nothing until everything else
 * has failed and it is bounded by REQUEST_TIMEOUT_MS when it does. Re-measure
 * before promoting it: `curl -w '%{time_total}'` against each model is enough.
 */
export const DEFAULT_MODEL = 'gemini-3.6-flash'

/** Generous: the failure mode of too small is a reply truncated mid-JSON. */
const DEFAULT_MAX_TOKENS = 8000

/**
 * How long one model gets before it is treated as unavailable.
 *
 * `fetch` has NO timeout of its own, and that is the whole reason the AI button
 * appeared to do nothing: a model stopped answering rather than refusing, so
 * the request sat open with nobody waiting on anything. A model that has not
 * begun answering in this long is not going to; the chain moves on and the desk
 * gets a document.
 *
 * Twenty seconds is generous by more than ten times — the models that work
 * answer in about a second and a half — and it is deliberately generous,
 * because cutting off a slow but healthy answer costs a real read.
 */
const REQUEST_TIMEOUT_MS = 20_000

export interface AskOptions<T> {
  system: string
  user: string
  /**
   * JSON Schema, in the ordinary dialect. Converted below into the subset
   * Gemini accepts — it wants upper-case type names and rejects
   * `additionalProperties` outright.
   */
  outputSchema: Record<string, unknown>
  /** The same shape again, to validate what comes back. */
  validate: ZodType<T>
  /** Extraction is not a reasoning task; 'low' is the cost lever. */
  effort?: 'low' | 'medium' | 'high'
  maxTokens?: number
  model?: string
}

export function aiAvailable(): boolean {
  return config.geminiApiKey !== null
}

/**
 * Ordinary JSON Schema -> the subset Gemini accepts.
 *
 * Three differences, all of which are a 400 rather than a warning:
 *   - type names are upper case ("STRING", not "string")
 *   - `additionalProperties` is not supported and must be dropped
 *   - `propertyOrdering` is honoured, and setting it makes replies consistent
 */
function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties') continue

    if (key === 'type' && typeof value === 'string') {
      out.type = value.toUpperCase()
    } else if (key === 'properties' && value && typeof value === 'object') {
      const props: Record<string, unknown> = {}
      for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
        props[name] = toGeminiSchema(child as Record<string, unknown>)
      }
      out.properties = props
      out.propertyOrdering = Object.keys(props)
    } else if (key === 'items' && value && typeof value === 'object') {
      out.items = toGeminiSchema(value as Record<string, unknown>)
    } else {
      out[key] = value
    }
  }

  return out
}

/**
 * 503 UNAVAILABLE from this endpoint is routine and genuinely random: the same
 * request, sent twice a second apart, gets a 200 and a 503. Measured on this
 * account, not assumed — four identical calls returned 503, 503, 503, 200.
 *
 * So one model is not enough. These are tried in order, each once, and the
 * first that answers wins. Ordered by what MEASURABLY answers rather than by
 * version — see DEFAULT_MODEL — and every one is a flash model because this is
 * a button someone presses while a customer waits.
 *
 * Only UNAVAILABLE moves to the next model. A quota error or a malformed
 * request will fail identically however many models it is sent to, and trying
 * four of them just makes the desk wait four times as long to read the same
 * sentence.
 */
const MODEL_FALLBACKS = ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.7-flash']

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function askAi<T>(opts: AskOptions<T>): Promise<AiResult<T>> {
  const key = config.geminiApiKey
  if (!key) {
    return { ok: false, reason: 'The AI features are not configured — no API key is set on the server.' }
  }

  const first = opts.model ?? config.geminiModel ?? DEFAULT_MODEL
  const chain = [first, ...MODEL_FALLBACKS.filter((m) => m !== first)]

  let last: AiResult<T> = { ok: false, reason: 'The AI service did not answer.' }

  for (const [index, model] of chain.entries()) {
    last = await askOnce(key, { ...opts, model })
    if (last.ok) return last
    // Anything other than overload will not improve on another model.
    if (!last.reason.includes('busy')) return last
    if (index < chain.length - 1) await sleep(250)
  }

  return {
    ok: false,
    reason: 'Every AI model is busy right now. Try again in a moment.',
  }
}

async function askOnce<T>(key: string, opts: AskOptions<T>): Promise<AiResult<T>> {
  const model = opts.model ?? config.geminiModel ?? DEFAULT_MODEL

  // fetch waits for ever by default, and "for ever" is exactly what one of
  // these models started doing. The signal is what turns a hang into an answer
  // the chain can act on.
  const cutOff = AbortSignal.timeout(REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      signal: cutOff,
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: 'user', parts: [{ text: opts.user }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(opts.outputSchema),
          maxOutputTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: opts.effort === 'medium' ? 0.4 : 0,
        },
      }),
    })

    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as
        | { error?: { message?: string; status?: string } }
        | null
      const status = detail?.error?.status
      // The two the desk will actually hit, said plainly.
      if (status === 'RESOURCE_EXHAUSTED') {
        return { ok: false, reason: 'The AI quota for this key is used up for now.' }
      }
      if (status === 'UNAVAILABLE') {
        return { ok: false, reason: 'The AI service is busy. Try again in a moment.' }
      }
      return {
        ok: false,
        reason: `The AI service returned ${response.status}${
          detail?.error?.message ? ` — ${detail.error.message.slice(0, 140)}` : ''
        }.`,
      }
    }

    const body = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
      promptFeedback?: { blockReason?: string }
    }

    if (body.promptFeedback?.blockReason) {
      return { ok: false, reason: 'The AI declined to answer that.' }
    }

    const candidate = body.candidates?.[0]
    if (candidate?.finishReason === 'MAX_TOKENS') {
      return { ok: false, reason: 'The AI ran out of room before finishing — the thread may be very long.' }
    }
    if (candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'PROHIBITED_CONTENT') {
      return { ok: false, reason: 'The AI declined to answer that.' }
    }

    const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    if (text.trim() === '') return { ok: false, reason: 'The AI returned nothing usable.' }

    const parsed = opts.validate.safeParse(JSON.parse(text))
    if (!parsed.success) {
      return { ok: false, reason: 'The AI replied in an unexpected shape, so it was discarded.' }
    }

    return { ok: true, data: parsed.data }
  } catch (err) {
    // A model that stops answering has to read as BUSY, not as a hard failure:
    // "busy" is the one word askAi looks for to try the next model, and a
    // timeout is precisely the case where the next model is worth trying. Get
    // this wrong and the cut-off above just fails faster than it used to.
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return {
        ok: false,
        reason: `The AI model ${model} is busy — it did not answer within ${
          REQUEST_TIMEOUT_MS / 1000
        } seconds.`,
      }
    }
    // A network blip, DNS, a malformed body — a sentence, not a stack.
    return { ok: false, reason: `Could not reach the AI service (${(err as Error).message}).` }
  }
}
