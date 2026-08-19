import Anthropic from '@anthropic-ai/sdk'
import type { ZodType } from 'zod'
import { config } from '../config.js'

/**
 * The one place this application talks to Claude.
 *
 * Every call site needs the same six things — an API-key check, a refusal
 * guard, a content guard, a JSON parse, a Zod validation, and a promise never
 * to throw. Written once here rather than four times.
 *
 * NEVER THROWS. No key, refusal, empty content, malformed JSON, schema
 * mismatch, network error, rate limit — all come back as
 * `{ ok: false, reason }` with a sentence a purchase-desk user can read. An AI
 * feature failing must never be an error page in a tool people quote from.
 */

export type ClaudeResult<T> = { ok: true; data: T } | { ok: false; reason: string }

export const DEFAULT_MODEL = 'claude-opus-5'

/**
 * `max_tokens` caps thinking AND output together, and thinking is on by
 * default on this model. Sized generously because the failure mode of getting
 * it wrong is a reply truncated mid-JSON, which reads as "the model got it
 * wrong" rather than "we did".
 */
const DEFAULT_MAX_TOKENS = 8000

export interface AskOptions<T> {
  system: string
  user: string
  /**
   * JSON Schema for the API constraint. Hand-written beside the Zod schema:
   * the SDK's zodOutputFormat helper is typed against zod v4 and this project
   * is on v3. Structured outputs require `additionalProperties: false` and
   * every property listed in `required`.
   */
  outputSchema: Record<string, unknown>
  /** The same shape again, to validate what comes back. */
  validate: ZodType<T>
  /**
   * Extraction is not a reasoning task — 'low' is the cost lever. Do NOT
   * disable thinking instead: on this model a disabled-thinking request can
   * leak thinking tags into the output.
   */
  effort?: 'low' | 'medium' | 'high'
  maxTokens?: number
  model?: string
}

export function claudeAvailable(): boolean {
  return config.anthropicApiKey !== null
}

export async function askClaude<T>(opts: AskOptions<T>): Promise<ClaudeResult<T>> {
  if (!config.anthropicApiKey) {
    return { ok: false, reason: 'Claude is not configured — no API key is set on the server.' }
  }

  try {
    const client = new Anthropic({ apiKey: config.anthropicApiKey })

    const response = await client.messages.create({
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: opts.system,
      output_config: {
        effort: opts.effort ?? 'low',
        format: { type: 'json_schema', schema: opts.outputSchema },
      },
      messages: [{ role: 'user', content: opts.user }],
    })

    // Always before reading content: on a refusal the content array is empty
    // and content[0] would throw.
    if (response.stop_reason === 'refusal') {
      return { ok: false, reason: 'Claude declined to answer that.' }
    }
    if (response.stop_reason === 'max_tokens') {
      return {
        ok: false,
        reason: 'Claude ran out of room before finishing — the thread may be very long.',
      }
    }

    const text = response.content.find((block) => block.type === 'text')?.text
    if (!text) return { ok: false, reason: 'Claude returned nothing usable.' }

    const parsed = opts.validate.safeParse(JSON.parse(text))
    if (!parsed.success) {
      return { ok: false, reason: 'Claude replied in an unexpected shape, so it was discarded.' }
    }

    return { ok: true, data: parsed.data }
  } catch (err) {
    // A network blip, a rate limit, an overloaded API — a sentence, not a stack.
    return { ok: false, reason: `Could not reach Claude (${(err as Error).message}).` }
  }
}
