import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { newRowKey } from './src/lib/rowKey'

/**
 * The desk reaches QA and production over plain http:// on the LAN, which is
 * not a secure context. Browsers withhold some APIs there entirely — the
 * property is simply undefined — while localhost counts as secure, so the
 * developer never sees the failure. That is how randomUUID shipped: "Read the
 * thread" worked on every laptop and failed on every real thread in QA and
 * production with "crypto.randomUUID is not a function".
 *
 * This reads the source rather than the built bundle so that it always runs;
 * a bundle check would need web/dist and would skip without it.
 *
 * navigator.clipboard is secure-context-only too, and deliberately not listed:
 * CoveringEmail calls it inside a try and tells the desk to copy by hand when
 * it is missing. Anything listed here throws instead.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'src')

const SECURE_CONTEXT_ONLY: Array<[string, RegExp]> = [
  ['randomUUID', /\brandomUUID\s*\(/],
  ['crypto.subtle', /\bcrypto\.subtle\b/],
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    // Tests run under node, where these exist; only what ships to a browser counts.
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : []
  })
}

describe('client code on plain http://', () => {
  const files = sourceFiles(SRC)

  it('scans the client source at all', () => {
    // Without this, a moved directory makes the check below pass on nothing.
    expect(files.length, `no .ts/.tsx files found under ${SRC}`).toBeGreaterThan(10)
  })

  it('calls no API a browser withholds outside a secure context', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const [name, pattern] of SECURE_CONTEXT_ONLY) {
        expect(
          source,
          `${path.relative(SRC, file)} uses ${name}, which is undefined on http://192.168.1.x`,
        ).not.toMatch(pattern)
      }
    }
  })

  it('gives every editor row its own key', () => {
    const keys = Array.from({ length: 500 }, () => newRowKey())
    expect(new Set(keys).size).toBe(keys.length)
  })
})
