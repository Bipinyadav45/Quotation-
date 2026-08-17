import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * §12 — "No API key in any client bundle, no key in the repo."
 *
 * Checking the source is not enough: a key leaks into a browser bundle when
 * something server-side gets imported from client code, and the source looks
 * fine right up until the bundler inlines it. So this reads the BUILT output.
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

  it.runIf(built)('contains no Anthropic API key or key reference', () => {
    const envPath = path.resolve(ROOT, '.env')
    const realKey = existsSync(envPath)
      ? /ANTHROPIC_API_KEY\s*=\s*(\S+)/.exec(readFileSync(envPath, 'utf8'))?.[1]
      : undefined

    for (const file of everyFile(DIST)) {
      const contents = readFileSync(file, 'utf8')
      const relative = path.relative(ROOT, file)

      expect(contents, `${relative} references the API key env var`).not.toContain(
        'ANTHROPIC_API_KEY',
      )
      // The key prefix, in case a literal was pasted somewhere.
      expect(contents, `${relative} contains something shaped like an API key`).not.toMatch(
        /sk-ant-[A-Za-z0-9_-]{10}/,
      )
      if (realKey && realKey.length > 8) {
        expect(contents, `${relative} contains the REAL key from .env`).not.toContain(realKey)
      }
    }
  })

  it.runIf(built)('pulls in no server-only module', () => {
    // If any of these appear, something under web/ imported a server module and
    // dragged the whole server surface — and its secrets — into the browser.
    const serverOnly = ['better-sqlite3', 'node:child_process', '@anthropic-ai/sdk']
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
