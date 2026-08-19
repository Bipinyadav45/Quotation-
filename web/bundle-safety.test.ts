import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * §12 — "No API key in any client bundle, no key in the repo."
 *
 * Checking the source is not enough: a key leaks into a browser bundle when
 * something server-side gets imported from client code, and the source looks
 * fine right up until the bundler inlines it. So this reads the BUILT output,
 * and it greps for the REAL key out of .env rather than only the variable name
 * — a bundler inlines the value, not the name.
 *
 * Run `npm run build` first; without web/dist there is nothing to check and the
 * test says so rather than passing quietly.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.resolve(ROOT, 'web', 'dist')

function everyFile(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    return statSync(full).isDirectory() ? everyFile(full) : [full]
  })
}

describe('the built client bundle', () => {
  const built = existsSync(DIST)

  it.runIf(built)('contains no API key, for any provider', () => {
    const envPath = path.resolve(ROOT, '.env')
    // Every secret the server holds, not just the one that happened to exist
    // when this was written.
    const env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
    const realKeys = [...env.matchAll(/^(?:\w*_?API_KEY|\w*_KEY|\w*_TOKEN|\w*_SECRET)\s*=\s*(\S+)/gim)]
      .map((m) => m[1]!)
      .filter((v) => v.length > 8)

    for (const file of everyFile(DIST)) {
      const contents = readFileSync(file, 'utf8')
      const relative = path.relative(ROOT, file)

      for (const name of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY']) {
        expect(contents, `${relative} references ${name}`).not.toContain(name)
      }

      // Key shapes, in case a literal was ever pasted into the source.
      expect(contents, `${relative} contains something shaped like an API key`).not.toMatch(
        /sk-ant-[A-Za-z0-9_-]{10}|AIza[A-Za-z0-9_-]{20}|AQ\.[A-Za-z0-9_-]{20}/,
      )

      for (const secret of realKeys) {
        expect(contents, `${relative} contains a REAL secret from .env`).not.toContain(secret)
      }
    }
  })

  it.runIf(built)('pulls in no server-only module', () => {
    // If any of these appear, something under web/ imported a server module and
    // dragged the whole server surface — and its secrets — into the browser.
    const serverOnly = [
      'better-sqlite3',
      'node:child_process',
      'generativelanguage.googleapis.com',
      'x-goog-api-key',
    ]
    for (const file of everyFile(DIST).filter((f) => f.endsWith('.js'))) {
      const contents = readFileSync(file, 'utf8')
      for (const marker of serverOnly) {
        expect(contents, `${path.relative(ROOT, file)} pulled in ${marker}`).not.toContain(marker)
      }
    }
  })

  it('fails loudly if the bundle was never built', () => {
    expect(
      built,
      'web/dist is missing — run `npm run build` before trusting the bundle-safety tests',
    ).toBe(true)
  })
})
